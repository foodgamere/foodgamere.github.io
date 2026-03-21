/**
 * 江湖帖自动跑分优化器
 *
 * ==================== 算法总体架构 ====================
 * 
 * 核心思路：先选菜谱，再选厨师（厨师排名只有在选择了菜谱后才准确）
 * 全程纯内存计算，不触碰DOM，通过 _simState 模拟状态进行搜索。
 * 
 * === 第一阶段：菜谱优先初始化 ===
 * 1. 意图分析（_analyzeIntents）：
 *    - 分析每个贵客每个厨师位置的意图列表
 *    - 识别 Order 位置指定意图（从指定位置取种子菜谱）
 *    - 识别 CreateIntent 链式意图（先放触发菜，再从加成位置取种子）
 *    - 跳过纯饱食度意图（SatietyChange/SatietyChangePercent/SetSatietyValue）
 *    - 结果缓存在 _intentCache 和 _recipeDependentIntentCache
 * 
 * 2. 协同种子生成（_buildSynergyPairs）：
 *    - 预计算厨师-菜谱协同加成对（售价/基础加成类技能匹配）
 *    - 每个贵客生成 top协同对 × 位置数 的候选方案
 *    - 与菜谱优先种子合并，取top5候选
 * 
 * 3. 菜谱排名（_fastGetRecipeRanking）三阶段：
 *    - Phase1：固定intentAdds粗排全部菜谱（极快）→ top50
 *    - Phase2：逐候选重算intentAdds+partialRecipeAdds精排（仅对有菜谱依赖意图的位置）→ top preFilterTop
 *    - Phase3：精确rule分数计算（含饱食度等全局效果）
 *    - Phase2动态候选数：topK<=3时精排top8，否则精排top15
 * 
 * 4. 种子精调（_quickRefineFast）：
 *    - lightMode=true/1：1轮只调菜谱（最快）
 *    - lightMode=N（数字>1）：N轮含厨师调整（中等）
 *    - lightMode=false：CONFIG.refineIter轮完整精调（最深）
 *    - 自适应：菜谱总数>800用轻量，否则完整
 * 
 * === 第二阶段：多起点搜索 ===
 * 5. 种子去重：精确去重（分数完全相同才合并）
 *    - 模糊去重（1%阈值）会导致关键种子被吞掉，已验证回退
 * 
 * 6. 每个种子的搜索流程：
 *    a. 爬山（_runClimbingPhase）：最多5轮，每轮尝试厨师替换+菜谱替换+菜谱交换
 *       - 厨师替换：遍历每个位置，尝试所有可用厨师
 *       - 菜谱替换：遍历每个位置，尝试top菜谱
 *       - 菜谱交换（_climbRecipeSwap）：尝试任意两个位置的菜谱互换
 *       - 收敛即停
 *    b. 爬山后跳过检查：
 *       - 爬山无改进且 < 全局最佳90% → 跳过深度搜索
 *       - 即使有改进，< 全局最佳88% → 也跳过（差距太大）
 *       - 90%-95%之间的"边界种子"：轻量深度搜索（1轮跨贵客，跳过重建）
 *    c. 跨贵客重分配（_crossGuestReassign）：最多2轮
 *       - 方案A：清空目标贵客，用意图感知重新填充 + 精调
 *         少菜谱(<=800)用完整精调，多菜谱用轻量
 *       - 方案B：对目标贵客每个位置，尝试top5种子菜谱替换 + 精调
 *         少菜谱用2轮精调，多菜谱用轻量
 *       - 后补偿：如果跨贵客有改进，做一次完整精调弥补轻量模式的精度损失
 *    d. 整贵客重建（_fullGuestRebuild）：
 *       - 仅在跨贵客有改进时才执行（条件执行）
 *       - 厨师候选数限制为5（原10）
 *    e. 最终爬山+交换：
 *       - 仅在前面阶段有改进时执行（条件执行）
 * 
 * 7. 种子间优化：
 *    - 收敛提前终止：如果某种子最终分数与之前某种子完全相同，跳过剩余种子
 *    - 分数过低跳过：起始分 < 全局最佳90% 直接跳过
 * 
 * === 关键参数（CONFIG） ===
 * - recipeSeedK: 5     种子菜谱数
 * - chefPerSeed: 3     每种子试几个厨师
 * - recipeTopN: 5      菜谱排名取前N（穷举搜索用）
 * - maxRounds: 5       爬山轮数
 * - refineIter: 5      精调迭代轮数
 * - preFilterTop: 50   预过滤候选数
 * 
 * === 自适应阈值 ===
 * - 菜谱总数 > 800：跨贵客用轻量精调（方案A: true, 方案B: true）
 * - 菜谱总数 <= 800：跨贵客用深度精调（方案A: false完整, 方案B: 2轮）
 * - 种子初始化精调同理（>800轻量，<=800完整）
 * 
 * 
 * === 分数提升的主要来源 ===
 * - 跨贵客重分配：把好厨师/菜谱从一个贵客移到另一个
 * - 菜谱交换：同贵客内不同位置的菜谱互换
 * - 意图感知种子选择：利用意图链条找到高分起点
 */

var JianghuOptimizer = (function() {
    'use strict';
    
    var _isRunning = false;
    var _targetScore = null;
    var _bestResult = null;
    var _gameData = null;
    var _rules = [];
    var _bestScore = 0;
    var _guestFilter = null;

    var CONFIG = {
        recipeSeedK: 5,       // 种子菜谱数
        chefPerSeed: 3,      // 每种子试几个厨师
        recipeTopN: 5,       // 菜谱排名取前N（穷举搜索用）
        maxRounds: 5,        // 爬山轮数
        refineIter: 5,       // 精调迭代轮数
        perturbRounds: 30,   // 扰动重建轮数（随机扰动补充用）
        perturbPositions: 2, // 每轮扰动位置数
        preFilterTop: 50     // 预过滤候选数
    };

    // ==================== 江湖帖档位分数数据 ====================
    // 江湖帖只有两个档位：普通、特级
    // 数据来源：贵客-工作表1.csv
    var JIANGHU_TIER_SCORES = {
        '铁拐李': { normal: 65120, special: 81400 },
        '何仙姑': { normal: 60560, special: 75700 },
        '钟离权': { normal: 110560, special: 138200 },
        '张国老': { normal: 85920, special: 107400 },
        '蓝采和': { normal: 65632, special: 82040 },
        '韩湘子': { normal: 50232, special: 62790 },
        '曹国舅': { normal: 84160, special: 105200 },
        '吕洞宾': { normal: 78800, special: 98500 },
        '王老板': { normal: 126960, special: 158700 },
        '风水大师': { normal: 99280, special: 124100 },
        '土地婆': { normal: 63440, special: 79300 },
        '不明人': { normal: 75680, special: 94600 },
        '打更人': { normal: 114080, special: 142600 },
        '苏侍中': { normal: 65520, special: 81900 },
        '涧迭': { normal: 81600, special: 102000 },
        '贾一': { normal: 50352, special: 62940 },
        '秋风': { normal: 114192, special: 142740 },
        '玉贵人': { normal: 100480, special: 125600 },
        '苏妲己': { normal: 142640, special: 178300 },
        '胡喜媚': { normal: 46664, special: 58330 },
        '空空': { normal: 45904, special: 57380 },
        '卷帘大将': { normal: 98880, special: 123600 },
        '猪猪男孩': { normal: 91720, special: 114650 },
        '白马王子': { normal: 57600, special: 72000 },
        '御弟哥哥': { normal: 82456, special: 103070 }
    };

    // 贤客楼：5档分数，按高到低存储（5档 -> 1档）
    // 数据来源：贵客-工作表1.csv
    var XIANKE_TIER_SCORES = {
        '王老板 周1357': [60000, 30000, 10000, 2000, 200],
        '土地婆 周2467': [60000, 30000, 10000, 2000, 200],
        '风水大师 周135': [200000, 130000, 80000, 40000, 20000],
        '风水大师 周246': [200000, 130000, 80000, 40000, 20000]
    };

    // 保留风云宴的数据结构以兼容接口
    var BANQUET_LEVELS = [
        { id: 'jianghu', name: '江湖帖', dual: false, rewards: [] }
    ];

    var BANQUET_TIER_SCORES = {};

    /**
     * 根据当前规则中的贵客Title，查找对应的江湖帖/贤客楼分数数据
     * @param {string} title1 - 贵客Title（从规则标题中提取）
     * @returns {string|null} 分数表中的key
     */
    function _findTierScoreKey(title1, title2) {
        if (!title1) return null;
        
        // 江湖帖规则标题格式：江湖帖 贵客名 [特]
        // 例如："江湖帖 铁拐李"、"江湖帖 何仙姑 特"
        // 提取贵客名称
        var match = title1.match(/江湖帖\s+([^\s]+)/);
        if (match && match[1]) {
            var guestName = match[1];
            // 检查是否存在该贵客的分数数据
            if (JIANGHU_TIER_SCORES[guestName]) {
                return guestName;
            }
        }

        // 贤客楼规则标题格式：
        // 例如："贤客楼 王老板 一 金币 周1357"、"贤客楼 风水大师 五 切蒸煮符文 周246"
        var xiankeMatch = title1.match(/贤客楼\s+([^\s]+)\s+[一二三四五]\s+.*\s+(周\d+)/);
        if (xiankeMatch && xiankeMatch[1] && xiankeMatch[2]) {
            var xiankeKey = xiankeMatch[1] + ' ' + xiankeMatch[2];
            if (XIANKE_TIER_SCORES[xiankeKey]) {
                return xiankeKey;
            }
        }
        
        return null;
    }

    /**
     * 获取指定贵客在指定档位的目标分数
     * @param {string} key - 分数表中的key
     * @param {number} levelIndex - 级别索引（江湖帖/贤客楼固定为0）
     * @param {number} tierIndex - 江湖帖: 0=特级,1=普通；贤客楼: 0=5档最高,4=1档最低
     * @returns {number|null}
     */
    function _getTierScore(key, levelIndex, tierIndex) {
        if (!key) return null;
        if (JIANGHU_TIER_SCORES[key]) {
            var data = JIANGHU_TIER_SCORES[key];
            
            // tierIndex: 0=特级, 1=普通
            if (tierIndex === 0) {
                return data.special;
            } else if (tierIndex === 1) {
                return data.normal;
            }
        }
        if (XIANKE_TIER_SCORES[key]) {
            if (tierIndex >= 0 && tierIndex < XIANKE_TIER_SCORES[key].length) {
                return XIANKE_TIER_SCORES[key][tierIndex];
            }
        }
        
        return null;
    }

    var _timeStats = {};
    
    // ==================== 内存计算层 ====================
    // 
    // 核心数据结构 _simState:
    // _simState[ruleIndex][chefIndex] = { chefId, chefObj, equipObj, recipes: [{data, quantity, max}] }
    //
    // 所有搜索操作都在 _simState 上进行，不触碰DOM
    
    var _simState = null;    // 当前模拟状态
    var _bestSimState = null; // 最佳模拟状态
    var _topCandidates = []; // top候选种子（用于多种子扰动）
    var _cachedConfig = {};  // 缓存的DOM配置（只读一次）
    var _chefMap = {};       // chefId -> chef对象的快速查找
    var _recipeMap = {};     // recipeId -> recipe.data的快速查找
    var _menusByRule = [];   // 每个rule的可用菜谱列表
    var _quantitySearchMode = 'full'; // full=按最大份数搜索, single=按单份搜索结构

    /**
     * 检查是否已达到目标分数
     */
    function _isTargetReached() {
        return _targetScore && _bestScore >= _targetScore;
    }

    /**
     * 检查所有贵客的饱食度是否都达标
     * 达标标准：当前饱食度必须完全等于目标饱食度
     */
    function _isAllSatietyOk() {
        for (var ri = 0; ri < _rules.length; ri++) {
            var rule = _rules[ri];
            if (!rule.Satiety) {
                continue; // 没有饱食度要求的跳过
            }
            
            var currentSatiety = _calcCurrentSatiety(ri);
            var targetSatiety = rule.Satiety;
            
            // 四舍五入到整数进行比较（因为饱食度可能是浮点数）
            var currentRounded = Math.round(currentSatiety);
            var targetRounded = Math.round(targetSatiety);
            
            // 必须完全相等才算达标（取整后比较）
            if (currentRounded !== targetRounded) {
                return false;
            }
        }
        return true;
    }

    /**
     * 检查饱食度差值是否在可接受范围内（<=2）
     * 用于判断是否值得进行爬山优化
     */
    function _isSatietyDiffAcceptable() {
        for (var ri = 0; ri < _rules.length; ri++) {
            var rule = _rules[ri];
            if (!rule.Satiety) continue;
            
            var currentSatiety = _calcCurrentSatiety(ri);
            var targetSatiety = rule.Satiety;
            var currentRounded = Math.round(currentSatiety);
            var targetRounded = Math.round(targetSatiety);
            var diff = Math.abs(currentRounded - targetRounded);
            
            // 如果任何一个贵客的差值>2，认为不可接受
            if (diff > 2) {
                return false;
            }
        }
        return true;
    }

    /**
     * 检查是否已达到目标分数且饱食度达标
     */
    function _isTargetReachedWithSatiety() {
        return _isTargetReached() && _isAllSatietyOk();
    }

    function _getActiveQuantityMode() {
        return _quantitySearchMode || 'full';
    }

    function _getRecipeInitialQuantity(maxQty, quantityMode) {
        if (!maxQty || maxQty <= 0) return 0;
        return quantityMode === 'single' ? 1 : maxQty;
    }

    function _calcTotalQuantity(state) {
        var targetState = state || _simState;
        var total = 0;
        if (!targetState) return total;
        for (var ri = 0; ri < targetState.length; ri++) {
            for (var ci = 0; ci < targetState[ri].length; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    var rec = targetState[ri][ci].recipes[reci];
                    if (rec && rec.data && rec.quantity > 0) total += rec.quantity;
                }
            }
        }
        return total;
    }

    /**
     * 精确计算某个rule当前总食材消耗（基于实际菜谱份数和厨师减耗）
     */
    function _calcRuleMaterialUsage(ruleIndex) {
        var rule = _rules[ruleIndex];
        var ruleState = _simState[ruleIndex];
        if (!rule || !rule.materials || !ruleState) return 0;

        var remainMaterials = JSON.parse(JSON.stringify(rule.materials));
        for (var ci = 0; ci < ruleState.length; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = ruleState[ci].recipes[reci];
                if (rec && rec.data && rec.quantity > 0) {
                    updateMaterialsData(remainMaterials, rec, rec.quantity, ruleState[ci].chefObj);
                }
            }
        }

        var used = 0;
        for (var mi = 0; mi < remainMaterials.length; mi++) {
            var initQty = Number(rule.materials[mi].quantity) || 0;
            var remainQty = Number(remainMaterials[mi].quantity) || 0;
            var consumed = initQty - remainQty;
            if (consumed > 0) used += consumed;
        }
        return used;
    }

    /**
     * 计算某个rule当前饱食度差值（取整后）
     */
    function _calcRuleSatietyGap(ruleIndex) {
        var rule = _rules[ruleIndex];
        var ruleState = _simState[ruleIndex];
        if (!rule || !rule.Satiety || !ruleState) return 0;

        var satTotal = 0;
        for (var ci = 0; ci < ruleState.length; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = ruleState[ci].recipes[reci];
                if (rec && rec.data) satTotal += rec.satiety || 0;
            }
        }

        return Math.abs(Math.round(satTotal) - Math.round(rule.Satiety));
    }

    function init(gameData) {
        _bestResult = null;
        _isRunning = false;
        _targetScore = null;
        _gameData = gameData || null;
        _rules = [];
        _bestScore = 0;
        _quantitySearchMode = 'full';
        _simState = null;
        _bestSimState = null;
        _topCandidates = [];
        
        if (typeof calCustomRule !== 'undefined' && calCustomRule && calCustomRule.rules) {
            _rules = calCustomRule.rules;
        }
        
        if (_rules.length === 0) {
            return false;
        }
        
        if (!_rules[0].Satiety) {
            return false;
        }
        
        // 缓存DOM配置（只读一次）
        _cachedConfig = {
            useGot: $("#chk-cal-got").prop("checked"),
            useEquip: $("#chk-cal-use-equip").prop("checked"),
            useAmber: $("#chk-cal-use-amber").prop("checked"),
            maxDisk: $("#chk-cal-max-disk").prop("checked"),
            recipeRarity: $("#chk-cal-recipe-rarity").val() || [],
            recipeSkill: $("#chk-cal-recipe-skill").val() || [],
            multipleSkill: $("#chk-cal-recipe-multiple-skill").prop("checked"),
            recipeCondiment: $("#chk-cal-recipe-condiment").val() || [],
            excludeMaterials: $("#chk-cal-recipe-material-exclude").val() || []
        };
        
        // 构建快速查找表
        _chefMap = {};
        _menusByRule = [];
        _recipeMap = {};
        _intentCache = {};  // 清空意图缓存
        _recipeDependentIntentCache = {};  // 清空菜谱依赖意图缓存
        _threeSkillIntentCache = {};  // 清空三道技法意图缓存
        _condimentIntentCache = {};  // 清空调料加成缓存
        _rarityRankIntentCache = {};  // 清空稀有度/品阶加成缓存
        _cookSkillIntentCache = {};  // 清空技法加成缓存
        _synergyCache = {};  // 清空协同缓存
        _intentAddCache = {};  // 清空IntentAdd缓存
        _priceAuraChefCache = {};  // 清空售价光环缓存
        
        for (var ri = 0; ri < _rules.length; ri++) {
            var rule = _rules[ri];
            // 厨师查找表
            if (rule.chefs) {
                for (var ci = 0; ci < rule.chefs.length; ci++) {
                    _chefMap[rule.chefs[ci].chefId] = rule.chefs[ci];
                }
            }
            // 菜谱列表（预过滤）
            var menus = [];
            if (rule.menus) {
                for (var mi = 0; mi < rule.menus.length; mi++) {
                    var recipe = rule.menus[mi].recipe;
                    if (!recipe || !recipe.data) continue;
                    var rd = recipe.data;
                    // 过滤已有
                    if (_cachedConfig.useGot && !rd.got && !isAllUltimateMode) continue;
                    // 过滤星级
                    if (_cachedConfig.recipeRarity.length > 0 && _cachedConfig.recipeRarity.indexOf(rd.rarity.toString()) < 0) continue;
                    // 过滤技法
                    if (_cachedConfig.recipeSkill.length > 0) {
                        var skillPass = false;
                        for (var si = 0; si < _cachedConfig.recipeSkill.length; si++) {
                            if (rd[_cachedConfig.recipeSkill[si]] > 0) {
                                skillPass = true;
                                if (!_cachedConfig.multipleSkill) break;
                            } else if (_cachedConfig.multipleSkill) {
                                skillPass = false;
                                break;
                            }
                        }
                        if (!skillPass) continue;
                    }
                    // 过滤调料
                    if (_cachedConfig.recipeCondiment.length > 0 && _cachedConfig.recipeCondiment.indexOf(rd.condiment) < 0) continue;
                    // 过滤排除食材
                    if (_cachedConfig.excludeMaterials.length > 0 && rd.materials) {
                        var matExcluded = false;
                        for (var ei = 0; ei < rd.materials.length; ei++) {
                            if (_cachedConfig.excludeMaterials.indexOf(rd.materials[ei].material.toString()) >= 0) {
                                matExcluded = true;
                                break;
                            }
                        }
                        if (matExcluded) continue;
                    }
                    menus.push(rd);
                    _recipeMap[rd.recipeId] = rd;
                }
            }
            _menusByRule.push(menus);
        }
        
        return true;
    }

    // ==================== 模拟状态管理 ====================

    function _shouldProcessRule(ruleIndex) {
        if (_guestFilter === null) return true;
        return ruleIndex === _guestFilter;
    }

    /**
     * 初始化模拟状态（从系统当前状态读取，或创建空状态）
     */
    function _initSimState() {
        _simState = [];
        for (var ri = 0; ri < _rules.length; ri++) {
            var rule = _rules[ri];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            var ruleState = [];
            for (var ci = 0; ci < numChefs; ci++) {
                ruleState.push({
                    chefId: null,
                    chefObj: null,  // 深拷贝的厨师对象（已setDataForChef）
                    equipObj: {},
                    recipes: [{data: null, quantity: 0, max: 0}, {data: null, quantity: 0, max: 0}, {data: null, quantity: 0, max: 0}]
                });
            }
            _simState.push(ruleState);
        }
    }

    function _cloneSimState(state) {
        if (!state) return null;
        var clone = [];
        for (var ri = 0; ri < state.length; ri++) {
            var ruleClone = [];
            for (var ci = 0; ci < state[ri].length; ci++) {
                var s = state[ri][ci];
                ruleClone.push({
                    chefId: s.chefId,
                    chefObj: s.chefObj ? JSON.parse(JSON.stringify(s.chefObj)) : null,
                    equipObj: s.equipObj ? JSON.parse(JSON.stringify(s.equipObj)) : {},
                    recipes: [
                        {data: s.recipes[0].data, quantity: s.recipes[0].quantity, max: s.recipes[0].max},
                        {data: s.recipes[1].data, quantity: s.recipes[1].quantity, max: s.recipes[1].max},
                        {data: s.recipes[2].data, quantity: s.recipes[2].quantity, max: s.recipes[2].max}
                    ]
                });
            }
            clone.push(ruleClone);
        }
        return clone;
    }

    /**
     * 在模拟状态中设置厨师（纯内存，不触碰DOM）
     */
    function _simSetChef(ruleIndex, chefIndex, chefId) {
        var slot = _simState[ruleIndex][chefIndex];
        if (!chefId) {
            slot.chefId = null;
            slot.chefObj = null;
            slot.equipObj = {};
            return;
        }
        
        var rule = _rules[ruleIndex];
        var srcChef = null;
        for (var i = 0; i < rule.chefs.length; i++) {
            if (rule.chefs[i].chefId === chefId) {
                srcChef = rule.chefs[i];
                break;
            }
        }
        if (!srcChef) return;
        
        slot.chefId = chefId;
        slot.chefObj = JSON.parse(JSON.stringify(srcChef));
        
        // 处理心法盘等级
        if (_cachedConfig.maxDisk) {
            slot.chefObj.disk.level = slot.chefObj.disk.maxLevel;
        }
        
        // 处理遗玉
        if (!_cachedConfig.useAmber) {
            for (var ai = 0; ai < slot.chefObj.disk.ambers.length; ai++) {
                slot.chefObj.disk.ambers[ai].data = null;
            }
        }
        
        // 处理厨具
        if (_cachedConfig.useEquip && srcChef.equipId) {
            slot.equipObj = getEquipInfo(srcChef.equipId, rule.equips) || {};
        } else {
            slot.equipObj = {};
        }
        
        // 调用 setDataForChef 计算厨师属性值（这是纯计算函数，不操作DOM）
        _applyChefData(ruleIndex);
    }

    /**
     * 在模拟状态中设置菜谱（纯内存）
     * 修复：计算份数时扣除同rule内其他已选菜谱的食材消耗，匹配系统setCustomRecipe逻辑
     * preRemainMaterials: 可选，预计算的剩余食材池（避免重复计算）
     */
    function _simSetRecipe(ruleIndex, chefIndex, recipeIndex, recipeId, preRemainMaterials, desiredQty) {
        var slot = _simState[ruleIndex][chefIndex];
        if (!recipeId) {
            slot.recipes[recipeIndex] = {data: null, quantity: 0, max: 0};
            return;
        }
        
        var recipeData = _recipeMap[recipeId];
        if (!recipeData) {
            // 在rule的menus中查找
            var rule = _rules[ruleIndex];
            if (rule.menus) {
                for (var i = 0; i < rule.menus.length; i++) {
                    if (rule.menus[i].recipe.data.recipeId === recipeId) {
                        recipeData = rule.menus[i].recipe.data;
                        _recipeMap[recipeId] = recipeData;
                        break;
                    }
                }
            }
        }
        if (!recipeData) return;
        
        var rule = _rules[ruleIndex];
        
        // 构建扣除其他已选菜谱食材后的剩余食材池（匹配setCustomRecipe逻辑）
        var remainMaterials;
        if (preRemainMaterials) {
            remainMaterials = preRemainMaterials;
        } else {
            remainMaterials = _calcRemainMaterials(ruleIndex, chefIndex, recipeIndex);
        }
        
        // 用剩余食材计算份数
        var maxQty = getRecipeQuantity(recipeData, remainMaterials, rule, slot.chefObj);
        if (rule.DisableMultiCookbook) maxQty = Math.min(maxQty, 1);
        var qty;
        if (desiredQty == null) {
            qty = _getRecipeInitialQuantity(maxQty, _getActiveQuantityMode());
        } else {
            qty = Math.min(Math.max(desiredQty, 0), maxQty);
        }
        
        slot.recipes[recipeIndex] = {data: recipeData, quantity: qty, max: maxQty};
    }

    /**
     * 计算某个rule中排除指定位置后的剩余食材
     */
    function _calcRemainMaterials(ruleIndex, excludeChef, excludeRecipe) {
        var rule = _rules[ruleIndex];
        var remainMaterials = JSON.parse(JSON.stringify(rule.materials));
        var ruleState = _simState[ruleIndex];
        for (var ci = 0; ci < ruleState.length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                if (ci === excludeChef && ri === excludeRecipe) continue;
                var rec = ruleState[ci].recipes[ri];
                if (rec.data && rec.quantity > 0) {
                    updateMaterialsData(remainMaterials, rec, rec.quantity, ruleState[ci].chefObj);
                }
            }
        }
        return remainMaterials;
    }

    /**
     * 对一个rule的所有厨师调用setDataForChef（纯计算）
     */
    function _applyChefData(ruleIndex) {
        var rule = _rules[ruleIndex];
        var ruleState = _simState[ruleIndex];
        
        // 构建临时custom数组供getPartialChefAdds使用
        var customArr = [];
        for (var ci = 0; ci < ruleState.length; ci++) {
            customArr.push({
                chef: ruleState[ci].chefObj || {},
                equip: ruleState[ci].equipObj || {},
                recipes: ruleState[ci].recipes,
                condiment: {}
            });
        }
        
        var partialAdds = getPartialChefAdds(customArr, rule);
        
        for (var ci = 0; ci < ruleState.length; ci++) {
            if (ruleState[ci].chefObj && ruleState[ci].chefObj.chefId) {
                setDataForChef(
                    ruleState[ci].chefObj,
                    ruleState[ci].equipObj,
                    true,
                    rule.calGlobalUltimateData,
                    partialAdds[ci],
                    rule.calSelfUltimateData,
                    rule.calActivityUltimateData,
                    true,
                    rule,
                    true,
                    rule.calQixiaData || null
                );
            }
        }
    }

    /**
     * 计算单个rule的分数（完全匹配calCustomResults逻辑）
     * 参数 applyChef: 是否重新计算厨师属性
     */
    function _calcRuleScore(ruleIndex, applyChef) {
        var rule = _rules[ruleIndex];
        var ruleState = _simState[ruleIndex];
        
        if (applyChef !== false) _applyChefData(ruleIndex);
        
        // 匹配calCustomResults — setDataForChef后重新计算max并限制quantity
        for (var ci = 0; ci < ruleState.length; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = ruleState[ci].recipes[reci];
                if (rec.data) {
                    var recipeMax = getRecipeQuantity(rec.data, rule.materials, rule, ruleState[ci].chefObj);
                    if (rule.DisableMultiCookbook) recipeMax = Math.min(recipeMax, 1);
                    rec.max = recipeMax;
                    if (rec.quantity > recipeMax) rec.quantity = recipeMax;
                }
            }
        }
        
        var customArr = [];
        for (var ci = 0; ci < ruleState.length; ci++) {
            customArr.push({
                chef: ruleState[ci].chefObj || {},
                equip: ruleState[ci].equipObj || {},
                recipes: ruleState[ci].recipes,
                condiment: {}
            });
        }
        
        var partialRecipeAdds = getPartialRecipeAdds(customArr, rule);
        var intentAdds = getIntentAdds(ruleIndex, customArr, _gameData, false);
        
        // 匹配 calCustomResults: u += Math.ceil(+(g.totalScore * (1 + g.data.activityAddition / 100)).toFixed(2))
        var u = 0;
        for (var ci = 0; ci < ruleState.length; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = ruleState[ci].recipes[reci];
                if (rec.data) {
                    var g = getRecipeResult(
                        ruleState[ci].chefObj,
                        ruleState[ci].equipObj,
                        rec.data,
                        rec.quantity,
                        rec.max,
                        rule.materials,
                        rule,
                        rule.decorationEffect,
                        null,
                        true,
                        customArr[ci].recipes,
                        partialRecipeAdds[3 * ci + reci],
                        intentAdds[3 * ci + reci]
                    );
                    var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
                    u += Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));
                    ruleState[ci].recipes[reci].satiety = g.satiety;
                }
            }
        }
        
        // 匹配 calCustomResults: scoreMultiply / scorePow / Math.floor / scoreAdd
        var h = 1;
        if (rule.hasOwnProperty("scoreMultiply")) h = rule.scoreMultiply;
        var m = 1;
        if (rule.hasOwnProperty("scorePow")) m = rule.scorePow;
        var v = 0;
        if (rule.hasOwnProperty("scoreAdd")) v = rule.scoreAdd;
        
        u = +(Math.pow(u, m) * h).toFixed(2);
        u = rule.IsActivity ? Math.ceil(u) : Math.floor(u);
        if (u) u += v;
        
        // 饱食度加成（使用系统函数 calSatiety 的逻辑）
        if (rule.Satiety) {
            var satTotal = 0;
            var satCount = 0;
            var expected = 3 * (rule.IntentList ? rule.IntentList.length : 3);
            for (var ci = 0; ci < ruleState.length; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    if (ruleState[ci].recipes[reci].data) {
                        satTotal += ruleState[ci].recipes[reci].satiety || 0;
                        satCount++;
                    }
                }
            }
            if (satCount === expected) {
                var satAdd = getSatietyPercent(satTotal, rule);
                u = calSatietyAdd(u, satAdd);
            }
        }
        
        return u;
    }

    /**
     * 内存计算总分
     */
    function _fastCalcScore() {
        var totalScore = 0;
        for (var ri = 0; ri < _rules.length; ri++) {
            totalScore += _calcRuleScore(ri, true);
        }
        return totalScore;
    }

    /**
     * 计算单个rule的分数（用于快速排名，只算当前rule）
     */
    function _fastCalcRuleScore(ruleIndex) {
        return _calcRuleScore(ruleIndex, true);
    }

    /**
     * 快速获取厨师排名
     * fastMode=true时只计算当前rule的分数（初始化阶段用，快很多）
     * fastMode=false时计算全局分数（爬山阶段用，更准确）
     * 返回: [{chefId, score, used, skillOk}] 按score降序
     */
    function _fastGetChefRanking(ruleIndex, chefIndex, fastMode) {
        var rule = _rules[ruleIndex];
        var ruleState = _simState[ruleIndex];

        // 检查当前位置是否有菜谱
        var hasRecipe = false;
        for (var reci = 0; reci < 3; reci++) {
            if (ruleState[chefIndex].recipes[reci].data) {
                hasRecipe = true;
                break;
            }
        }

        // 收集所有已用厨师
        var usedChefIds = {};
        for (var ri = 0; ri < _simState.length; ri++) {
            for (var ci = 0; ci < _simState[ri].length; ci++) {
                if (ri === ruleIndex && ci === chefIndex) continue;
                if (_simState[ri][ci].chefId) {
                    usedChefIds[_simState[ri][ci].chefId] = true;
                }
            }
        }

        var results = [];

        if (!hasRecipe) {
            // 没有菜谱时，按稀有度排序
            for (var i = 0; i < rule.chefs.length; i++) {
                var chef = rule.chefs[i];
                if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
                results.push({
                    chefId: chef.chefId,
                    score: chef.rarity,
                    used: !!usedChefIds[chef.chefId],
                    satGap: 0,
                    materialUsage: 0
                });
            }
        } else {
            // 有菜谱时，计算每个厨师的得分
            var savedChefObj = ruleState[chefIndex].chefObj;
            var savedChefId = ruleState[chefIndex].chefId;
            var savedEquipObj = ruleState[chefIndex].equipObj;

            var calcFn = fastMode ? function() { return _fastCalcRuleScore(ruleIndex); } : _fastCalcScore;
            var preferMaterialUsage = (_targetScore && _targetScore > 0);

            for (var i = 0; i < rule.chefs.length; i++) {
                var chef = rule.chefs[i];
                if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
                // 跳过已用厨师（快速排名时不需要评估已用的）
                if (fastMode && usedChefIds[chef.chefId]) continue;

                // 临时设置厨师
                _simSetChef(ruleIndex, chefIndex, chef.chefId);

                // 检查技法是否足够
                var chefObj = ruleState[chefIndex].chefObj;
                var skillOk = true;
                var tempChef = JSON.parse(JSON.stringify(chefObj));
                for (var reci = 0; reci < 3; reci++) {
                    if (ruleState[chefIndex].recipes[reci].data) {
                        addCheffSkillDiff(tempChef, ruleState[chefIndex].recipes[reci].data);
                    }
                }
                var diff = getChefSillDiff(tempChef, chefObj);
                if (diff !== "") skillOk = false;

                // 技法不足直接跳过（不浪费时间算分）
                if (!skillOk) {
                    results.push({ chefId: chef.chefId, score: -1, used: false, skillOk: false, satGap: Infinity, materialUsage: Infinity });
                    continue;
                }

                var score = calcFn();
                var satGap = preferMaterialUsage ? _calcRuleSatietyGap(ruleIndex) : 0;
                var materialUsage = preferMaterialUsage ? _calcRuleMaterialUsage(ruleIndex) : 0;

                results.push({
                    chefId: chef.chefId,
                    score: score,
                    used: !!usedChefIds[chef.chefId],
                    skillOk: true,
                    satGap: satGap,
                    materialUsage: materialUsage
                });
            }

            // 恢复原厨师
            ruleState[chefIndex].chefId = savedChefId;
            ruleState[chefIndex].chefObj = savedChefObj;
            ruleState[chefIndex].equipObj = savedEquipObj;
            _applyChefData(ruleIndex);
        }

        var preferMaterialUsageSort = (_targetScore && _targetScore > 0);
        results.sort(function(a, b) {
            if (preferMaterialUsageSort) {
                var satGapA = (typeof a.satGap === 'number') ? a.satGap : Infinity;
                var satGapB = (typeof b.satGap === 'number') ? b.satGap : Infinity;
                if (satGapA !== satGapB) return satGapA - satGapB;

                var usageA = (typeof a.materialUsage === 'number') ? a.materialUsage : Infinity;
                var usageB = (typeof b.materialUsage === 'number') ? b.materialUsage : Infinity;
                if (usageA !== usageB) return usageA - usageB;
            }

            var chefA = _chefMap[a.chefId];
            var chefB = _chefMap[b.chefId];
            var materialReduceA = _hasMaterialReduceEffect(chefA) ? 1 : 0;
            var materialReduceB = _hasMaterialReduceEffect(chefB) ? 1 : 0;
            if (materialReduceA !== materialReduceB) {
                return materialReduceB - materialReduceA;
            }
            return b.score - a.score;
        });
        return results;
    }

    /**
     * 快速获取菜谱排名（纯内存，替代getCustomRecipesOptions）
     * 优化：三阶段排名
     *   第一阶段：固定intentAdds粗排（全部菜谱）→ top50
     *   第二阶段：逐候选重算intentAdds精排（top50）→ top preFilterTop
     *   第三阶段：精确rule分数计算（top preFilterTop，含饱食度等全局效果）
     * fastMode=true时只计算当前rule的分数
     * 返回: [{recipeId, score}] 按score降序
     */
    function _fastGetRecipeRanking(ruleIndex, chefIndex, recipeIndex, topK, fastMode, quantityMode) {
        var rule = _rules[ruleIndex];
        var menus = _menusByRule[ruleIndex];
        var ruleState = _simState[ruleIndex];
        var activeQuantityMode = quantityMode || _getActiveQuantityMode();
        
        // 收集所有已用菜谱
        var usedRecipeIds = {};
        for (var ri = 0; ri < _simState.length; ri++) {
            for (var ci = 0; ci < _simState[ri].length; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    if (ri === ruleIndex && ci === chefIndex && reci === recipeIndex) continue;
                    var rec = _simState[ri][ci].recipes[reci];
                    if (rec.data) {
                        usedRecipeIds[rec.data.recipeId] = true;
                    }
                }
            }
        }
        
        var chefObj = ruleState[chefIndex].chefObj;
        var savedRecipe = ruleState[chefIndex].recipes[recipeIndex];
        var slotIdx = 3 * chefIndex + recipeIndex;
        
        // ===== 分析调料/稀有度/品阶/技法加成意图 =====
        var condimentBonus = _analyzeCondimentIntents(ruleIndex);
        var rarityRankBonus = _analyzeRarityRankIntents(ruleIndex);
        var cookSkillBonus = _analyzeCookSkillIntents(ruleIndex);
        var intentAddInfo = _analyzeIntentAddPositions(ruleIndex);
        var rankPref = _analyzeRankPreference(ruleIndex);
        
        // ===== 预计算基准加成（循环外只算一次） =====
        var baseCustomArr = [];
        for (var ci2 = 0; ci2 < ruleState.length; ci2++) {
            baseCustomArr.push({
                chef: ruleState[ci2].chefObj || {},
                equip: ruleState[ci2].equipObj || {},
                recipes: ruleState[ci2].recipes,
                condiment: {}
            });
        }
        var basePartialAdds = getPartialRecipeAdds(baseCustomArr, rule);
        var baseIntentAdds = getIntentAdds(ruleIndex, baseCustomArr, _gameData, false);
        var slotPartialAdds = basePartialAdds[slotIdx];
        var slotIntentAdds = baseIntentAdds[slotIdx];
        
        // 预计算剩余食材（排除当前位置）
        var preRemainMaterials = _calcRemainMaterials(ruleIndex, chefIndex, recipeIndex);
        
        // ===== 第一阶段：固定intentAdds粗排（全部菜谱） =====
        var phase1 = [];
        
        for (var i = 0; i < menus.length; i++) {
            var rd = menus[i];
            if (usedRecipeIds[rd.recipeId]) continue;
            
            // 检查厨师技法
            if (chefObj && chefObj.chefId) {
                if (rd.stirfry > 0 && (!chefObj.stirfryVal || chefObj.stirfryVal < rd.stirfry)) continue;
                if (rd.boil > 0 && (!chefObj.boilVal || chefObj.boilVal < rd.boil)) continue;
                if (rd.knife > 0 && (!chefObj.knifeVal || chefObj.knifeVal < rd.knife)) continue;
                if (rd.fry > 0 && (!chefObj.fryVal || chefObj.fryVal < rd.fry)) continue;
                if (rd.bake > 0 && (!chefObj.bakeVal || chefObj.bakeVal < rd.bake)) continue;
                if (rd.steam > 0 && (!chefObj.steamVal || chefObj.steamVal < rd.steam)) continue;
            }
            
            var maxQty = getRecipeQuantity(rd, preRemainMaterials, rule, chefObj);
            if (rule.DisableMultiCookbook) maxQty = Math.min(maxQty, 1);
            var qty = _getRecipeInitialQuantity(maxQty, activeQuantityMode);
            
            var tempRecipes = [
                ruleState[chefIndex].recipes[0],
                ruleState[chefIndex].recipes[1],
                ruleState[chefIndex].recipes[2]
            ];
            tempRecipes[recipeIndex] = {data: rd, quantity: qty, max: qty};
            
            var g = getRecipeResult(
                chefObj, ruleState[chefIndex].equipObj,
                rd, qty, qty, rule.materials, rule,
                rule.decorationEffect, null, true,
                tempRecipes,
                slotPartialAdds,
                slotIntentAdds
            );
            var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
            var est = Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));
            
            // 加入调料/稀有度/品阶/技法加成的考虑（作为排序加分）
            var bonusWeight = 0;
            if (rd.condiment && condimentBonus[rd.condiment]) {
                bonusWeight += condimentBonus[rd.condiment];
            }
            if (rd.rarity && rarityRankBonus.rarityBonus[rd.rarity]) {
                bonusWeight += rarityRankBonus.rarityBonus[rd.rarity];
            }
            if (rd.rank && rarityRankBonus.rankBonus[rd.rank]) {
                bonusWeight += rarityRankBonus.rankBonus[rd.rank];
            }
            // 技法加成：检查菜谱的所有技法
            var skillKeys = ['stirfry', 'fry', 'bake', 'steam', 'boil', 'knife'];
            for (var ski = 0; ski < skillKeys.length; ski++) {
                var sk = skillKeys[ski];
                if (rd[sk] > 0 && cookSkillBonus[sk]) {
                    bonusWeight += cookSkillBonus[sk];
                }
            }
            
            // 优化1: IntentAdd叠加加分 — 如果当前位置有IntentAdd，
            // 能触发更多同位置意图条件的菜谱获得额外加分
            if (intentAddInfo.hasIntentAdd && intentAddInfo.positionWeights[chefIndex]) {
                // 当前位置有IntentAdd，检查菜谱能触发多少同位置意图
                var intentAddBonus = 0;
                // 调料匹配
                if (rd.condiment && condimentBonus[rd.condiment]) {
                    intentAddBonus += condimentBonus[rd.condiment] * 0.5; // IntentAdd翻倍效果
                }
                // 技法匹配
                for (var ski2 = 0; ski2 < skillKeys.length; ski2++) {
                    if (rd[skillKeys[ski2]] > 0 && cookSkillBonus[skillKeys[ski2]]) {
                        intentAddBonus += cookSkillBonus[skillKeys[ski2]] * 0.5;
                    }
                }
                // 稀有度匹配
                if (rd.rarity && rarityRankBonus.rarityBonus[rd.rarity]) {
                    intentAddBonus += rarityRankBonus.rarityBonus[rd.rarity] * 0.5;
                }
                bonusWeight += intentAddBonus;
            }
            
            // 优化4: 品阶偏好加分 — 如果有特定品阶触发高价值意图
            // 注意：这里只是排序加分，不改变实际品阶计算
            if (rankPref.hasRankPreference) {
                // 菜谱的品阶取决于厨师，这里用菜谱的rarity作为近似
                // 高rarity菜谱更容易达到高品阶
                for (var prefRank in rankPref.preferredRanks) {
                    var prefRankNum = Number(prefRank);
                    // 如果偏好的品阶不是最高的（5=传），说明可能需要控制品阶
                    if (prefRankNum <= 3 && rankPref.preferredRanks[prefRank] > 50) {
                        // 低rarity菜谱更容易停在低品阶，给予小加分
                        if (rd.rarity <= 3) {
                            bonusWeight += rankPref.preferredRanks[prefRank] * 0.2;
                        }
                    }
                }
            }
            
            // 将加成权重转换为等效分数（权重*10作为加分）
            var estWithBonus = est + bonusWeight * 10;
            
            phase1.push({rd: rd, qty: qty, est: est, estWithBonus: estWithBonus, bonusWeight: bonusWeight});
        }
        
        phase1.sort(function(a, b) { return b.estWithBonus - a.estWithBonus; });
        // 粗排取top（根据topK动态调整各阶段候选数）
        var needPhase2 = _hasRecipeDependentIntents(ruleIndex, chefIndex);
        // 动态候选数 — topK小时大幅减少Phase2/3开销
        var phase2Size, phase1Top;
        if (!needPhase2) {
            // 无菜谱依赖意图：跳过Phase2
            phase1Top = Math.max(topK || 10, CONFIG.preFilterTop);
            phase2Size = 0;
        } else if (topK && topK <= 3) {
            // 只需少量结果（贪心填充/精调）：Phase2只精排top8
            phase1Top = Math.max(topK, CONFIG.preFilterTop);
            phase2Size = 8;
        } else {
            // 需要较多结果（种子选择等）：Phase2精排top15
            phase1Top = Math.max(topK || 10, CONFIG.preFilterTop, 40);
            phase2Size = 15;
        }
        if (phase1.length > phase1Top) phase1.length = phase1Top;
        
        // ===== 第二阶段：逐候选重算intentAdds精排 =====
        // 仅当位置有依赖菜谱属性的意图时才执行Phase2
        // 且只对Phase1的top候选做精排，大幅减少调用次数
        var phase2 = [];
        
        if (needPhase2 && phase2Size > 0) {
            _timeStats.phase2Executed = (_timeStats.phase2Executed || 0) + 1;
            _timeStats.phase2Calls = (_timeStats.phase2Calls || 0) + Math.min(phase2Size, phase1.length);
            // 有菜谱依赖意图：对top候选逐个重算
            var phase2Limit = Math.min(phase2Size, phase1.length);
            for (var i = 0; i < phase2Limit; i++) {
                var rd = phase1[i].rd;
                var qty = phase1[i].qty;
                
                // 临时替换菜谱
                var tempRecipes = [
                    ruleState[chefIndex].recipes[0],
                    ruleState[chefIndex].recipes[1],
                    ruleState[chefIndex].recipes[2]
                ];
                tempRecipes[recipeIndex] = {data: rd, quantity: qty, max: qty};
                
                // 构建临时customArr，只替换当前chefIndex的recipes
                var tempCustomArr = [];
                for (var ci2 = 0; ci2 < ruleState.length; ci2++) {
                    if (ci2 === chefIndex) {
                        tempCustomArr.push({
                            chef: ruleState[ci2].chefObj || {},
                            equip: ruleState[ci2].equipObj || {},
                            recipes: tempRecipes,
                            condiment: {}
                        });
                    } else {
                        tempCustomArr.push(baseCustomArr[ci2]);
                    }
                }
                
                // 重算intentAdds（精确：考虑了候选菜谱的技法/稀有度等对意图触发的影响）
                var preciseIntentAdds = getIntentAdds(ruleIndex, tempCustomArr, _gameData, false);
                var preciseSlotIntentAdds = preciseIntentAdds[slotIdx];
                
                // 也重算partialRecipeAdds（候选菜谱可能影响菜谱间加成）
                var precisePartialAdds = getPartialRecipeAdds(tempCustomArr, rule);
                var preciseSlotPartialAdds = precisePartialAdds[slotIdx];
                
                var g = getRecipeResult(
                    chefObj, ruleState[chefIndex].equipObj,
                    rd, qty, qty, rule.materials, rule,
                    rule.decorationEffect, null, true,
                    tempRecipes,
                    preciseSlotPartialAdds,
                    preciseSlotIntentAdds
                );
                var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
                var est2 = Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));
                
                phase2.push({rd: rd, est: est2});
            }
            // 追加Phase1中未精排的候选（保留Phase1分数）
            for (var i = phase2Limit; i < phase1.length; i++) {
                phase2.push({rd: phase1[i].rd, est: phase1[i].est});
            }
            
            phase2.sort(function(a, b) { return b.est - a.est; });
            var maxCandidates = Math.max(topK || 10, CONFIG.preFilterTop);
            if (phase2.length > maxCandidates) phase2.length = maxCandidates;
        } else {
            _timeStats.phase2Skipped = (_timeStats.phase2Skipped || 0) + 1;
            // 无菜谱依赖意图或不需Phase2，Phase1排名直接传递
            for (var i = 0; i < phase1.length; i++) {
                phase2.push({rd: phase1[i].rd, est: phase1[i].est});
            }
        }
        
        // ===== 第三阶段：精确rule分数计算（含饱食度等全局效果） =====
        var results = [];
        var calcFn = fastMode ? function() { return _fastCalcRuleScore(ruleIndex); } : _fastCalcScore;
        
        for (var i = 0; i < phase2.length; i++) {
            _simSetRecipe(ruleIndex, chefIndex, recipeIndex, phase2[i].rd.recipeId, preRemainMaterials, null);
            var score = calcFn();
            results.push({recipeId: phase2[i].rd.recipeId, score: score});
        }
        
        // 恢复原菜谱
        ruleState[chefIndex].recipes[recipeIndex] = savedRecipe;
        
        results.sort(function(a, b) { return b.score - a.score; });
        if (topK && results.length > topK) results.length = topK;
        return results;
    }

    // ==================== 工具函数 ====================

    function _getChefNameById(chefId) {
        var chef = _chefMap[chefId];
        return chef ? chef.name : '未知';
    }

    function _hasMaterialReduceEffect(chefObj) {
        if (!chefObj || !chefObj.materialEffects || !chefObj.materialEffects.length) return false;
        for (var i = 0; i < chefObj.materialEffects.length; i++) {
            var effect = chefObj.materialEffects[i];
            if (!effect) continue;
            if (effect.type === 'MaterialReduce' || effect.conditionType === 'MaterialReduce') {
                return true;
            }
        }
        return false;
    }

    function _getUsedChefIds(excludeRule, excludeChef) {
        var used = {};
        for (var ri = 0; ri < _simState.length; ri++) {
            for (var ci = 0; ci < _simState[ri].length; ci++) {
                if (ri === excludeRule && ci === excludeChef) continue;
                if (_simState[ri][ci].chefId) {
                    used[_simState[ri][ci].chefId] = true;
                }
            }
        }
        return used;
    }

    // ==================== 意图分析 ====================

    /**
     * 纯饱食度effectType集合（不影响分数，种子选择时跳过）
     */
    var SATIETY_ONLY_EFFECTS = {
        'SatietyChange': true,
        'SatietyChangePercent': true,
        'SetSatietyValue': true
    };

    /**
     * 意图分析缓存（key: ruleIndex_chefIndex → result）
     */
    var _intentCache = {};

    /**
     * 三道技法意图缓存（key: ruleIndex → [{skill, buffEffect, weight}]）
     * 用于多技法组合种子生成
     */
    var _threeSkillIntentCache = {};

    /**
     * 分析"三道某技法"类型的意图
     * 这类意图的特点：当3道菜都包含某技法时，触发CreateBuff给下一轮加成
     * 返回: [{skill: 'stirfry', buffEffect: {...}, weight: 100}]
     */
    function _analyzeThreeSkillIntents(ruleIndex) {
        if (_threeSkillIntentCache.hasOwnProperty(ruleIndex)) {
            return _threeSkillIntentCache[ruleIndex];
        }
        
        var rule = _rules[ruleIndex];
        var results = [];
        var gName = rule.Title || ('贵客' + (ruleIndex + 1));
        
        if (!rule.IntentList || !_gameData || !_gameData.intents) {
            _threeSkillIntentCache[ruleIndex] = results;
            return results;
        }
        
        // 技法名称映射
        var skillNameMap = {
            'stirfry': '炒', 'fry': '炸', 'bake': '烤',
            'steam': '蒸', 'boil': '煮', 'knife': '切'
        };
        var skillKeys = ['stirfry', 'fry', 'bake', 'steam', 'boil', 'knife'];
        
        // 遍历所有厨师位置的意图
        for (var ci = 0; ci < rule.IntentList.length; ci++) {
            var intentIds = rule.IntentList[ci];
            if (!intentIds) {
                continue;
            }
            
            for (var ii = 0; ii < intentIds.length; ii++) {
                for (var jj = 0; jj < _gameData.intents.length; jj++) {
                    if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                    var intent = _gameData.intents[jj];
                    
                    // 检查是否是CreateBuff类型且desc包含"三道"
                    if (intent.effectType === 'CreateBuff' && intent.desc && intent.desc.indexOf('三道') >= 0) {
                        // 从desc中提取技法名称
                        for (var sk = 0; sk < skillKeys.length; sk++) {
                            var skillKey = skillKeys[sk];
                            var skillName = skillNameMap[skillKey];
                            if (intent.desc.indexOf('三道' + skillName) >= 0) {
                                // 计算权重：根据buff效果估算
                                var weight = 1;
                                if (_gameData.buffs) {
                                    for (var bk = 0; bk < _gameData.buffs.length; bk++) {
                                        if (_gameData.buffs[bk].buffId === intent.effectValue) {
                                            var buff = _gameData.buffs[bk];
                                            // 售价加成权重高
                                            if (buff.effectType === 'PriceChangePercent' || buff.effectType === 'BasicPriceChangePercent') {
                                                weight = Math.abs(buff.effectValue || 50);
                                            } else if (buff.effectType === 'BasicPriceChange') {
                                                weight = Math.abs(buff.effectValue || 100) / 2;
                                            } else {
                                                weight = 10; // 其他效果给基础权重
                                            }
                                            break;
                                        }
                                    }
                                }
                                
                                // 检查是否已存在相同技法
                                var exists = false;
                                for (var ri = 0; ri < results.length; ri++) {
                                    if (results[ri].skill === skillKey) {
                                        results[ri].weight += weight; // 累加权重
                                        exists = true;
                                        break;
                                    }
                                }
                                if (!exists) {
                                    results.push({
                                        skill: skillKey,
                                        skillName: skillName,
                                        intentDesc: intent.desc,
                                        weight: weight
                                    });
                                }
                                break;
                            }
                        }
                    }
                    break;
                }
            }
        }
        
        // 按权重降序排序
        results.sort(function(a, b) { return b.weight - a.weight; });
        _threeSkillIntentCache[ruleIndex] = results;
        return results;
    }

    /**
     * 分析"下道料理"和"下阶段"类型的意图
     * 包括：
     * 1. CreateIntent - 下道料理意图（当前轮内）
     * 2. CreateBuff（非Group条件）- 单道菜触发的下阶段buff（跨轮次）
     * 
     * 这类意图的特点：当前菜满足条件时，给下一道菜或下阶段创建加成
     * 如果有这类意图，触发它的菜不应该放在最后一位（位置2），否则加成浪费或减少触发机会
     * 
     * 返回: [{
     *   conditionType: 'CookSkill'/'Rarity'/etc,
     *   conditionValue: 'stirfry'/5/etc,
     *   desc: '4火：下道料理意图生效次数加一',
     *   weight: 50,  // 子意图/buff的价值权重
     *   intentType: 'CreateIntent'/'CreateBuff'
     * }]
     */
    function _analyzeNextDishIntents(ruleIndex, chefIndex) {
        var rule = _rules[ruleIndex];
        var results = [];
        
        if (!rule.IntentList || !rule.IntentList[chefIndex] || !_gameData || !_gameData.intents) {
            return results;
        }
        
        var intentIds = rule.IntentList[chefIndex];
        
        for (var ii = 0; ii < intentIds.length; ii++) {
            for (var jj = 0; jj < _gameData.intents.length; jj++) {
                if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                var intent = _gameData.intents[jj];
                
                // 1. 检查是否是CreateIntent类型（下道料理意图）
                if (intent.effectType === 'CreateIntent') {
                    // 找到子意图
                    var childIntent = null;
                    for (var kk = 0; kk < _gameData.intents.length; kk++) {
                        if (_gameData.intents[kk].intentId === intent.effectValue) {
                            childIntent = _gameData.intents[kk];
                            break;
                        }
                    }
                    
                    // 跳过纯饱食度的子意图
                    if (!childIntent || SATIETY_ONLY_EFFECTS[childIntent.effectType]) continue;
                    
                    // 计算子意图的价值权重
                    var weight = 1;
                    if (childIntent.effectType === 'PriceChangePercent' || childIntent.effectType === 'BasicPriceChangePercent') {
                        weight = Math.abs(childIntent.effectValue || 50);
                    } else if (childIntent.effectType === 'BasicPriceChange') {
                        weight = Math.abs(childIntent.effectValue || 100) / 2;
                    } else if (childIntent.effectType === 'IntentAdd') {
                        weight = Math.abs(childIntent.effectValue || 1) * 50; // 意图加一很有价值
                    } else {
                        weight = 10;
                    }
                    
                    results.push({
                        conditionType: intent.conditionType,
                        conditionValue: intent.conditionValue,
                        desc: intent.desc || 'CreateIntent',
                        childEffectType: childIntent.effectType,
                        weight: weight,
                        intentType: 'CreateIntent'
                    });
                }
                
                // 2. 检查是否是CreateBuff类型（下阶段buff）
                // 排除Group条件（三道某技法），因为那个需要3道菜才能触发，已在多技法种子中处理
                if (intent.effectType === 'CreateBuff' && intent.conditionType !== 'Group') {
                    // 找到buff
                    var buff = null;
                    if (_gameData.buffs) {
                        for (var bk = 0; bk < _gameData.buffs.length; bk++) {
                            if (_gameData.buffs[bk].buffId === intent.effectValue) {
                                buff = _gameData.buffs[bk];
                                break;
                            }
                        }
                    }
                    
                    // 跳过纯饱食度的buff
                    if (!buff || SATIETY_ONLY_EFFECTS[buff.effectType]) continue;
                    
                    // 计算buff的价值权重（跨轮次buff权重稍低，因为不影响当前轮）
                    var buffWeight = 1;
                    if (buff.effectType === 'PriceChangePercent' || buff.effectType === 'BasicPriceChangePercent') {
                        buffWeight = Math.abs(buff.effectValue || 50) * 0.5; // 跨轮次打5折
                    } else if (buff.effectType === 'BasicPriceChange') {
                        buffWeight = Math.abs(buff.effectValue || 100) / 4;
                    } else {
                        buffWeight = 5;
                    }
                    
                    results.push({
                        conditionType: intent.conditionType,
                        conditionValue: intent.conditionValue,
                        desc: intent.desc || 'CreateBuff',
                        buffEffectType: buff.effectType,
                        weight: buffWeight,
                        intentType: 'CreateBuff'
                    });
                }
                break;
            }
        }
        
        return results;
    }

    /**
     * 检查菜谱是否能触发"下道料理"意图
     * @param {Object} recipe - 菜谱数据
     * @param {Array} nextDishIntents - _analyzeNextDishIntents的返回结果
     * @returns {number} 能触发的意图总权重（0表示不能触发任何下道料理意图）
     */
    function _canTriggerNextDishIntent(recipe, nextDishIntents) {
        if (!nextDishIntents || nextDishIntents.length === 0) return 0;
        
        var totalWeight = 0;
        for (var i = 0; i < nextDishIntents.length; i++) {
            var ndi = nextDishIntents[i];
            var canTrigger = false;
            
            if (!ndi.conditionType) {
                // 无条件，任何菜都能触发
                canTrigger = true;
            } else if (ndi.conditionType === 'CookSkill') {
                // 技法条件
                var skillKey = ndi.conditionValue ? ndi.conditionValue.toLowerCase() : '';
                if (skillKey && recipe[skillKey] > 0) {
                    canTrigger = true;
                }
            } else if (ndi.conditionType === 'Rarity') {
                // 稀有度条件（几火）
                if (recipe.rarity === Number(ndi.conditionValue)) {
                    canTrigger = true;
                }
            } else if (ndi.conditionType === 'CondimentSkill') {
                // 调料条件
                if (recipe.condiment === ndi.conditionValue) {
                    canTrigger = true;
                }
            } else if (ndi.conditionType === 'Rank') {
                // 品阶条件
                if (recipe.rank === Number(ndi.conditionValue)) {
                    canTrigger = true;
                }
            }
            // Order条件在这里不处理（位置相关，不是菜谱属性）
            
            if (canTrigger) {
                totalWeight += ndi.weight;
            }
        }
        
        return totalWeight;
    }

    /**
     * 生成多技法组合
     * 输入: [{skill: 'stirfry', weight: 100}, {skill: 'bake', weight: 80}, ...]
     * 输出: [
     *   {skills: ['stirfry'], totalWeight: 100},
     *   {skills: ['stirfry', 'bake'], totalWeight: 180},
     *   {skills: ['stirfry', 'bake', 'steam'], totalWeight: 230},
     *   ...
     * ]
     */
    function _generateMultiSkillCombinations(threeSkillIntents) {
        var combinations = [];
        if (!threeSkillIntents || threeSkillIntents.length === 0) return combinations;
        
        // 单技法组合
        for (var i = 0; i < threeSkillIntents.length; i++) {
            combinations.push({
                skills: [threeSkillIntents[i].skill],
                skillNames: [threeSkillIntents[i].skillName],
                totalWeight: threeSkillIntents[i].weight
            });
        }
        
        // 双技法组合（最多取前3个技法的组合）
        var maxSkills = Math.min(3, threeSkillIntents.length);
        for (var i = 0; i < maxSkills; i++) {
            for (var j = i + 1; j < maxSkills; j++) {
                combinations.push({
                    skills: [threeSkillIntents[i].skill, threeSkillIntents[j].skill],
                    skillNames: [threeSkillIntents[i].skillName, threeSkillIntents[j].skillName],
                    totalWeight: threeSkillIntents[i].weight + threeSkillIntents[j].weight
                });
            }
        }
        
        // 三技法组合（如果有3个以上技法意图）
        if (threeSkillIntents.length >= 3) {
            combinations.push({
                skills: [threeSkillIntents[0].skill, threeSkillIntents[1].skill, threeSkillIntents[2].skill],
                skillNames: [threeSkillIntents[0].skillName, threeSkillIntents[1].skillName, threeSkillIntents[2].skillName],
                totalWeight: threeSkillIntents[0].weight + threeSkillIntents[1].weight + threeSkillIntents[2].weight
            });
        }
        
        // 按总权重降序排序
        combinations.sort(function(a, b) { return b.totalWeight - a.totalWeight; });
        
        return combinations;
    }

    /**
     * 筛选同时具有指定技法的菜谱
     * @param {number} ruleIndex - 贵客索引
     * @param {string[]} skills - 技法数组，如 ['stirfry', 'bake']
     * @returns {Array} 满足条件的菜谱列表
     */
    function _filterRecipesByMultiSkills(ruleIndex, skills) {
        var menus = _menusByRule[ruleIndex];
        var filtered = [];
        
        // 分析各种加成意图
        var condimentBonus = _analyzeCondimentIntents(ruleIndex);
        var rarityRankBonus = _analyzeRarityRankIntents(ruleIndex);
        
        for (var i = 0; i < menus.length; i++) {
            var rd = menus[i];
            var hasAllSkills = true;
            
            for (var j = 0; j < skills.length; j++) {
                if (!rd[skills[j]] || rd[skills[j]] <= 0) {
                    hasAllSkills = false;
                    break;
                }
            }
            
            if (hasAllSkills) {
                // 计算调料加成权重
                var condimentWeight = 0;
                if (rd.condiment && condimentBonus[rd.condiment]) {
                    condimentWeight = condimentBonus[rd.condiment];
                }
                
                // 计算稀有度加成权重
                var rarityWeight = 0;
                if (rd.rarity && rarityRankBonus.rarityBonus[rd.rarity]) {
                    rarityWeight = rarityRankBonus.rarityBonus[rd.rarity];
                }
                
                // 计算品阶加成权重
                var rankWeight = 0;
                if (rd.rank && rarityRankBonus.rankBonus[rd.rank]) {
                    rankWeight = rarityRankBonus.rankBonus[rd.rank];
                }
                
                filtered.push({
                    recipe: rd,
                    price: rd.price || 0,
                    bonusWeight: condimentWeight + rarityWeight + rankWeight
                });
            }
        }
        
        // 按价格+加成权重排序（加成权重转换为等效价格）
        filtered.sort(function(a, b) { 
            var scoreA = a.price + a.bonusWeight * 10; // 权重转换为等效价格
            var scoreB = b.price + b.bonusWeight * 10;
            return scoreB - scoreA; 
        });
        
        // 返回菜谱数据
        return filtered.map(function(f) { return f.recipe; });
    }

    /**
     * 分析调料加成意图
     * 返回: { 'Spicy': 100, 'Salty': 50, ... } 调料 -> 加成权重
     */
    var _condimentIntentCache = {};
    function _analyzeCondimentIntents(ruleIndex) {
        if (_condimentIntentCache.hasOwnProperty(ruleIndex)) {
            return _condimentIntentCache[ruleIndex];
        }
        var rule = _rules[ruleIndex];
        var condimentBonus = {};
        
        if (!rule.IntentList || !_gameData || !_gameData.intents) {
            return condimentBonus;
        }
        
        // 遍历所有厨师位置的意图
        for (var ci = 0; ci < rule.IntentList.length; ci++) {
            var intentIds = rule.IntentList[ci];
            if (!intentIds) continue;
            
            for (var ii = 0; ii < intentIds.length; ii++) {
                for (var jj = 0; jj < _gameData.intents.length; jj++) {
                    if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                    var intent = _gameData.intents[jj];
                    
                    // 检查是否是CondimentSkill条件的加成意图
                    if (intent.conditionType === 'CondimentSkill' && intent.conditionValue) {
                        // 跳过纯饱食度意图
                        if (SATIETY_ONLY_EFFECTS[intent.effectType]) continue;
                        
                        // 计算权重
                        var weight = 0;
                        if (intent.effectType === 'PriceChangePercent' || intent.effectType === 'BasicPriceChangePercent') {
                            weight = Math.abs(intent.effectValue || 0);
                        } else if (intent.effectType === 'BasicPriceChange') {
                            weight = Math.abs(intent.effectValue || 0) / 5; // 固定值转换为百分比等效
                        } else if (intent.effectType === 'IntentAdd') {
                            weight = 50; // 意图加一很有价值
                        } else if (intent.effectType === 'CreateIntent' || intent.effectType === 'CreateBuff') {
                            weight = 30; // 链式意图也有价值
                        }
                        
                        if (weight > 0) {
                            var condiment = intent.conditionValue;
                            if (!condimentBonus[condiment]) {
                                condimentBonus[condiment] = 0;
                            }
                            condimentBonus[condiment] += weight;
                        }
                    }
                    break;
                }
            }
        }
        
        _condimentIntentCache[ruleIndex] = condimentBonus;
        return condimentBonus;
    }

    /**
     * 分析稀有度（几火）和品阶加成意图
     * 返回: { rarityBonus: {1: 100, 5: 50}, rankBonus: {4: 100, 5: 50} }
     */
    var _rarityRankIntentCache = {};
    function _analyzeRarityRankIntents(ruleIndex) {
        if (_rarityRankIntentCache.hasOwnProperty(ruleIndex)) {
            return _rarityRankIntentCache[ruleIndex];
        }
        var rule = _rules[ruleIndex];
        var result = { rarityBonus: {}, rankBonus: {} };
        
        if (!rule.IntentList || !_gameData || !_gameData.intents) {
            return result;
        }
        
        // 遍历所有厨师位置的意图
        for (var ci = 0; ci < rule.IntentList.length; ci++) {
            var intentIds = rule.IntentList[ci];
            if (!intentIds) continue;
            
            for (var ii = 0; ii < intentIds.length; ii++) {
                for (var jj = 0; jj < _gameData.intents.length; jj++) {
                    if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                    var intent = _gameData.intents[jj];
                    
                    // 跳过纯饱食度意图
                    if (SATIETY_ONLY_EFFECTS[intent.effectType]) continue;
                    
                    // 计算权重
                    var weight = 0;
                    if (intent.effectType === 'PriceChangePercent' || intent.effectType === 'BasicPriceChangePercent') {
                        weight = Math.abs(intent.effectValue || 0);
                    } else if (intent.effectType === 'BasicPriceChange') {
                        weight = Math.abs(intent.effectValue || 0) / 5;
                    } else if (intent.effectType === 'IntentAdd') {
                        weight = 50;
                    } else if (intent.effectType === 'CreateIntent' || intent.effectType === 'CreateBuff') {
                        weight = 30;
                    }
                    
                    if (weight > 0) {
                        // 检查是否是Rarity条件
                        if (intent.conditionType === 'Rarity' && intent.conditionValue) {
                            var rarity = Number(intent.conditionValue);
                            if (!result.rarityBonus[rarity]) {
                                result.rarityBonus[rarity] = 0;
                            }
                            result.rarityBonus[rarity] += weight;
                        }
                        // 检查是否是Rank条件
                        else if (intent.conditionType === 'Rank' && intent.conditionValue) {
                            var rank = Number(intent.conditionValue);
                            if (!result.rankBonus[rank]) {
                                result.rankBonus[rank] = 0;
                            }
                            result.rankBonus[rank] += weight;
                        }
                    }
                    break;
                }
            }
        }
        
        _rarityRankIntentCache[ruleIndex] = result;
        return result;
    }

    /**
     * 分析技法加成意图（非"三道"类型的单道菜技法加成）
     * 返回: { 'stirfry': 100, 'steam': 50, ... } 技法 -> 加成权重
     */
    var _cookSkillIntentCache = {};
    function _analyzeCookSkillIntents(ruleIndex) {
        if (_cookSkillIntentCache.hasOwnProperty(ruleIndex)) {
            return _cookSkillIntentCache[ruleIndex];
        }
        var rule = _rules[ruleIndex];
        var skillBonus = {};
        
        if (!rule.IntentList || !_gameData || !_gameData.intents) {
            return skillBonus;
        }
        
        // 遍历所有厨师位置的意图
        for (var ci = 0; ci < rule.IntentList.length; ci++) {
            var intentIds = rule.IntentList[ci];
            if (!intentIds) continue;
            
            for (var ii = 0; ii < intentIds.length; ii++) {
                for (var jj = 0; jj < _gameData.intents.length; jj++) {
                    if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                    var intent = _gameData.intents[jj];
                    
                    // 检查是否是CookSkill条件的加成意图（排除"三道"类型，那个是Group条件）
                    if (intent.conditionType === 'CookSkill' && intent.conditionValue) {
                        // 跳过纯饱食度意图
                        if (SATIETY_ONLY_EFFECTS[intent.effectType]) continue;
                        
                        // 计算权重
                        var weight = 0;
                        if (intent.effectType === 'PriceChangePercent' || intent.effectType === 'BasicPriceChangePercent') {
                            weight = Math.abs(intent.effectValue || 0);
                        } else if (intent.effectType === 'BasicPriceChange') {
                            weight = Math.abs(intent.effectValue || 0) / 5;
                        } else if (intent.effectType === 'IntentAdd') {
                            weight = 50;
                        } else if (intent.effectType === 'CreateIntent' || intent.effectType === 'CreateBuff') {
                            weight = 30;
                        }
                        
                        if (weight > 0) {
                            var skill = intent.conditionValue.toLowerCase();
                            if (!skillBonus[skill]) {
                                skillBonus[skill] = 0;
                            }
                            skillBonus[skill] += weight;
                        }
                    }
                    break;
                }
            }
        }
        
        _cookSkillIntentCache[ruleIndex] = skillBonus;
        return skillBonus;
    }

    /**
     * 菜谱依赖意图缓存（key: ruleIndex_chefIndex → boolean）
     * true = 该位置有依赖候选菜谱属性的意图（需要Phase2）
     * false = 该位置意图不依赖菜谱属性（可跳过Phase2）
     */
    var _recipeDependentIntentCache = {};

    /**
     * 判断某个位置是否有依赖候选菜谱属性的意图
     * 依赖菜谱属性的conditionType: CookSkill, CondimentSkill, Rarity, Rank, Group
     * 不依赖菜谱属性的conditionType: Order, ChefStar, 无条件(null/undefined)
     * 
     * 同时检查CreateIntent/CreateBuff的子意图是否也依赖菜谱属性
     */
    function _hasRecipeDependentIntents(ruleIndex, chefIndex) {
        var cacheKey = ruleIndex + '_' + chefIndex;
        if (_recipeDependentIntentCache.hasOwnProperty(cacheKey)) {
            return _recipeDependentIntentCache[cacheKey];
        }
        
        var rule = _rules[ruleIndex];
        if (!rule.IntentList || !rule.IntentList[chefIndex] || !_gameData || !_gameData.intents) {
            _recipeDependentIntentCache[cacheKey] = false;
            return false;
        }
        
        var intentIds = rule.IntentList[chefIndex];
        var recipeDependentConditions = {
            'CookSkill': true,
            'CondimentSkill': true,
            'Rarity': true,
            'Rank': true,
            'Group': true
        };
        
        // 检查GlobalBuffList中的buff（也会对每个位置调用checkIntent）
        if (rule.GlobalBuffList && _gameData.buffs) {
            for (var bi = 0; bi < rule.GlobalBuffList.length; bi++) {
                for (var bj = 0; bj < _gameData.buffs.length; bj++) {
                    if (rule.GlobalBuffList[bi] === _gameData.buffs[bj].buffId) {
                        if (recipeDependentConditions[_gameData.buffs[bj].conditionType]) {
                            _recipeDependentIntentCache[cacheKey] = true;
                            return true;
                        }
                        break;
                    }
                }
            }
        }
        
        for (var ii = 0; ii < intentIds.length; ii++) {
            for (var jj = 0; jj < _gameData.intents.length; jj++) {
                if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                var intent = _gameData.intents[jj];
                
                // 检查主意图的条件类型
                if (recipeDependentConditions[intent.conditionType]) {
                    _recipeDependentIntentCache[cacheKey] = true;
                    return true;
                }
                
                // CreateIntent: 子意图也可能依赖菜谱属性
                if (intent.effectType === 'CreateIntent') {
                    for (var kk = 0; kk < _gameData.intents.length; kk++) {
                        if (_gameData.intents[kk].intentId === intent.effectValue) {
                            if (recipeDependentConditions[_gameData.intents[kk].conditionType]) {
                                _recipeDependentIntentCache[cacheKey] = true;
                                return true;
                            }
                            break;
                        }
                    }
                }
                
                // CreateBuff: buff也可能依赖菜谱属性
                if (intent.effectType === 'CreateBuff' && _gameData.buffs) {
                    for (var kk = 0; kk < _gameData.buffs.length; kk++) {
                        if (_gameData.buffs[kk].buffId === intent.effectValue) {
                            if (recipeDependentConditions[_gameData.buffs[kk].conditionType]) {
                                _recipeDependentIntentCache[cacheKey] = true;
                                return true;
                            }
                            break;
                        }
                    }
                }
                
                break;
            }
        }
        
        _recipeDependentIntentCache[cacheKey] = false;
        return false;
    }

    /**
     * 分析一个贵客某个厨师位置的意图，返回种子策略
     * 
     * 返回: {
     *   seedRecipeIndex: 最佳种子recipeIndex (0/1/2),
     *   prePlaceList: [{recipeIndex, filterFn}] 需要预先放置的菜谱（用于触发链式意图）,
     *   fillOrder: [0,1,2] 填充菜谱的顺序（种子位置优先）,
     *   intentInfo: 'xxx' 日志描述
     * }
     */
    function _analyzeIntents(ruleIndex, chefIndex) {
        // 缓存意图分析结果
        var cacheKey = ruleIndex + '_' + chefIndex;
        if (_intentCache.hasOwnProperty(cacheKey)) {
            return _intentCache[cacheKey];
        }
        
        var rule = _rules[ruleIndex];
        var result = {
            seedRecipeIndex: 0,
            prePlaceList: [],
            fillOrder: [0, 1, 2],
            intentInfo: ''
        };
        
        if (!rule.IntentList || !rule.IntentList[chefIndex] || !_gameData || !_gameData.intents) {
            _intentCache[cacheKey] = result;
            return result;
        }
        
        var intentIds = rule.IntentList[chefIndex];
        if (!intentIds || intentIds.length === 0) return result;
        
        // 查找所有意图对象
        var intents = [];
        for (var ii = 0; ii < intentIds.length; ii++) {
            for (var jj = 0; jj < _gameData.intents.length; jj++) {
                if (_gameData.intents[jj].intentId === intentIds[ii]) {
                    intents.push(_gameData.intents[jj]);
                    break;
                }
            }
        }
        
        if (intents.length === 0) {
            _intentCache[cacheKey] = result;
            return result;
        }
        
        // 分析每个意图，找出分数相关的加成位置
        var scoreBoostPositions = {}; // recipeIndex -> {weight, desc}
        var chainTriggers = [];       // [{triggerPos, bonusPos, conditionType, conditionValue, chainIntent, desc}]
        var infoList = [];
        
        for (var ii = 0; ii < intents.length; ii++) {
            var intent = intents[ii];
            
            // 跳过纯饱食度意图
            if (SATIETY_ONLY_EFFECTS[intent.effectType]) {
                // 但如果是CreateIntent/CreateBuff，其子意图可能影响分数，需要检查
                continue;
            }
            
            if (intent.effectType === 'CreateIntent') {
                // 链式意图：触发条件满足时，在下一个位置创建新意图
                // 需要找到子意图来判断是否影响分数
                var childIntent = null;
                for (var jj = 0; jj < _gameData.intents.length; jj++) {
                    if (_gameData.intents[jj].intentId === intent.effectValue) {
                        childIntent = _gameData.intents[jj];
                        break;
                    }
                }
                
                if (!childIntent || SATIETY_ONLY_EFFECTS[childIntent.effectType]) continue;
                
                // 这是一个影响分数的链式意图
                // 触发位置：满足conditionType的菜谱所在位置(u)
                // 加成位置：u+1
                // 我们需要遍历可能的触发位置
                var triggerCondType = intent.conditionType;
                var triggerCondVal = intent.conditionValue;
                
                if (triggerCondType === 'Order') {
                    // Order类型：固定位置触发
                    var triggerPos = intent.conditionValue - 1; // 0-based
                    if (triggerPos < 2) { // 只有0和1位置能触发（因为加成在triggerPos+1）
                        chainTriggers.push({
                            triggerPos: triggerPos,
                            bonusPos: triggerPos + 1,
                            conditionType: triggerCondType,
                            conditionValue: triggerCondVal,
                            chainIntent: childIntent,
                            desc: intent.desc || ('Order' + intent.conditionValue + '→CreateIntent')
                        });
                        infoList.push('链式(Order' + (triggerPos+1) + '→pos' + (triggerPos+2) + ')');
                    }
                } else if (triggerCondType === 'CookSkill' || triggerCondType === 'CondimentSkill' || 
                           triggerCondType === 'Rarity' || !triggerCondType) {
                    // 条件类型：任何满足条件的位置都可以触发
                    // 最佳策略：在位置0放满足条件的菜，位置1获得加成
                    // 也可以在位置1放，位置2获得加成
                    for (var tp = 0; tp < 2; tp++) {
                        chainTriggers.push({
                            triggerPos: tp,
                            bonusPos: tp + 1,
                            conditionType: triggerCondType,
                            conditionValue: triggerCondVal,
                            chainIntent: childIntent,
                            desc: intent.desc || (triggerCondType + ':' + triggerCondVal + '→CreateIntent')
                        });
                    }
                    var skillName = triggerCondVal || '无条件';
                    infoList.push('链式(' + (triggerCondType || '无条件') + ':' + skillName + '→下道菜加成)');
                }
            } else if (intent.effectType === 'CreateBuff') {
                // CreateBuff：创建buff影响后续轮次
                // Group条件（三道某技法）已在多技法种子中处理
                // 非Group条件的单道CreateBuff也应该考虑位置优化
                if (intent.conditionType !== 'Group') {
                    // 单道菜触发的buff，应该尽量放在前面位置以增加触发机会
                    // 找到buff来判断价值
                    var buff = null;
                    if (_gameData.buffs) {
                        for (var bk = 0; bk < _gameData.buffs.length; bk++) {
                            if (_gameData.buffs[bk].buffId === intent.effectValue) {
                                buff = _gameData.buffs[bk];
                                break;
                            }
                        }
                    }
                    
                    if (buff && !SATIETY_ONLY_EFFECTS[buff.effectType]) {
                        // 有价值的buff，记录为链式触发（虽然是跨轮次，但位置0/1比位置2更好）
                        var buffCondType = intent.conditionType;
                        var buffCondVal = intent.conditionValue;
                        
                        if (buffCondType !== 'Order') {
                            // 非Order条件，任何位置都可以触发，但前面位置更好
                            for (var tp = 0; tp < 2; tp++) {
                                chainTriggers.push({
                                    triggerPos: tp,
                                    bonusPos: tp, // buff是跨轮次的，bonusPos设为自己
                                    conditionType: buffCondType,
                                    conditionValue: buffCondVal,
                                    chainIntent: buff, // 用buff代替childIntent
                                    desc: intent.desc || (buffCondType + ':' + buffCondVal + '→CreateBuff'),
                                    isCrossTurn: true // 标记为跨轮次
                                });
                            }
                            infoList.push('单道Buff(' + (buffCondType || '无条件') + ':' + (buffCondVal || '') + ')');
                        }
                    }
                }
                // Group条件的三道意图不在这里处理
            } else if (intent.conditionType === 'Order') {
                // 直接效果 + Order条件：指定位置获得加成
                var bonusPos = intent.conditionValue - 1; // 0-based
                if (bonusPos >= 0 && bonusPos < 3) {
                    var weight = 1;
                    if (intent.effectType === 'BasicPriceChangePercent' || intent.effectType === 'PriceChangePercent') {
                        weight = Math.abs(intent.effectValue || 1);
                    } else if (intent.effectType === 'BasicPriceChange') {
                        weight = Math.abs(intent.effectValue || 100) / 100;
                    }
                    if (!scoreBoostPositions[bonusPos]) {
                        scoreBoostPositions[bonusPos] = {weight: 0, desc: []};
                    }
                    scoreBoostPositions[bonusPos].weight += weight;
                    scoreBoostPositions[bonusPos].desc.push(intent.effectType + ':' + (intent.effectValue || ''));
                    infoList.push('Order' + (bonusPos+1) + '加成(' + intent.effectType + ')');
                }
            } else if (intent.conditionType === 'CookSkill' || intent.conditionType === 'CondimentSkill' ||
                       intent.conditionType === 'Rarity' || intent.conditionType === 'Rank' ||
                       intent.conditionType === 'ChefStar' || intent.conditionType === 'Group' ||
                       !intent.conditionType) {
                // 非位置指定的直接效果意图：任何满足条件的菜都能触发
                // 这些意图不需要特殊的位置策略，正常评分即可
                // 但如果是CookSkill等，说明该位置需要特定技法的菜
                // 不做特殊处理
            }
        }
        
        // 决策：选择最佳种子位置
        // 优先级：1. 链式意图的加成位置  2. Order指定的加成位置  3. 默认位置0
        
        if (chainTriggers.length > 0) {
            // 有链式意图：选择加成最大的链
            // 策略：在triggerPos预放满足条件的菜，从bonusPos取种子
            var bestChain = null;
            var bestChainScore = -1;
            
            for (var ci = 0; ci < chainTriggers.length; ci++) {
                var chain = chainTriggers[ci];
                var childEff = chain.chainIntent.effectType;
                var childVal = Math.abs(chain.chainIntent.effectValue || 0);
                var chainScore = 0;
                
                if (childEff === 'BasicPriceChangePercent' || childEff === 'PriceChangePercent') {
                    chainScore = childVal;
                } else if (childEff === 'BasicPriceChange') {
                    chainScore = childVal / 100;
                } else if (childEff === 'IntentAdd') {
                    chainScore = childVal * 50; // IntentAdd间接放大其他意图
                } else {
                    chainScore = 1; // 其他类型给个基础分
                }
                
                // 优先选triggerPos=0的（这样bonusPos=1，种子在位置1，还有位置2可以自由选）
                if (chain.triggerPos === 0) chainScore += 0.1;
                
                // 优化5: 如果bonusPos有IntentAdd，链式意图的价值翻倍
                var intentAddInfo = _analyzeIntentAddPositions(ruleIndex);
                if (intentAddInfo.hasIntentAdd && intentAddInfo.positionWeights[chain.bonusPos]) {
                    chainScore *= 1.5; // IntentAdd位置的链式意图价值更高
                }
                
                // 优化2: 跨轮次buff的链式意图额外加分
                if (chain.isCrossTurn) {
                    chainScore *= 0.8; // 跨轮次稍微降权（不确定下一轮是否能利用）
                }
                
                if (chainScore > bestChainScore) {
                    bestChainScore = chainScore;
                    bestChain = chain;
                }
            }
            
            if (bestChain) {
                result.seedRecipeIndex = bestChain.bonusPos;
                
                // 构建预放置的过滤函数
                var filterFn = _buildConditionFilter(bestChain.conditionType, bestChain.conditionValue);
                if (filterFn) {
                    result.prePlaceList.push({
                        recipeIndex: bestChain.triggerPos,
                        filterFn: filterFn,
                        desc: bestChain.desc
                    });
                }
                
                // 构建填充顺序：种子位置 → 触发位置 → 其余
                result.fillOrder = _buildFillOrder(bestChain.bonusPos, bestChain.triggerPos);
                result.intentInfo = '链式意图: 触发pos' + (bestChain.triggerPos+1) + '→种子pos' + (bestChain.bonusPos+1);
            }
        } else if (Object.keys(scoreBoostPositions).length > 0) {
            // 有Order指定的加成位置：选权重最大的
            var bestPos = 0;
            var bestWeight = -1;
            for (var pos in scoreBoostPositions) {
                if (scoreBoostPositions[pos].weight > bestWeight) {
                    bestWeight = scoreBoostPositions[pos].weight;
                    bestPos = Number(pos);
                }
            }
            result.seedRecipeIndex = bestPos;
            result.fillOrder = _buildFillOrder(bestPos, -1);
            result.intentInfo = 'Order加成: 种子pos' + (bestPos+1) + ' (权重' + bestWeight.toFixed(1) + ')';
        }
        
        if (infoList.length > 0 && !result.intentInfo) {
            result.intentInfo = infoList.join(', ');
        }
        
        _intentCache[cacheKey] = result;
        return result;
    }

    /**
     * 根据条件类型构建菜谱过滤函数
     * 返回 function(recipeData) -> boolean
     */
    function _buildConditionFilter(conditionType, conditionValue) {
        if (!conditionType) {
            // 无条件：任何菜都满足
            return function() { return true; };
        }
        if (conditionType === 'CookSkill') {
            var skillKey = conditionValue ? conditionValue.toLowerCase() : '';
            if (!skillKey) return null;
            return function(rd) { return rd[skillKey] > 0; };
        }
        if (conditionType === 'CondimentSkill') {
            return function(rd) { return rd.condiment === conditionValue; };
        }
        if (conditionType === 'Rarity') {
            var rarityVal = Number(conditionValue);
            return function(rd) { return rd.rarity === rarityVal; };
        }
        // Order类型不需要过滤（位置本身就是条件）
        if (conditionType === 'Order') {
            return function() { return true; };
        }
        // Group/ChefStar/Rank 等条件依赖厨师或全局状态，无法在菜谱级别过滤
        return null;
    }

    /**
     * 构建填充顺序：种子位置优先，然后触发位置，最后其余
     */
    function _buildFillOrder(seedPos, triggerPos) {
        var order = [];
        order.push(seedPos);
        if (triggerPos >= 0 && triggerPos !== seedPos) {
            order.push(triggerPos);
        }
        for (var i = 0; i < 3; i++) {
            if (order.indexOf(i) < 0) order.push(i);
        }
        return order;
    }

    // ==================== 优化1: IntentAdd叠加分析 ====================

    /**
     * 分析IntentAdd意图的位置分布
     * IntentAdd意图使同位置的其他意图生效次数+1，相当于翻倍
     * 返回: { positionWeights: {0: weight, 1: weight, 2: weight}, hasIntentAdd: boolean }
     * 
     * 策略：如果某个位置有IntentAdd，该位置的其他意图会被翻倍
     * 因此应该在IntentAdd位置放能触发最多高价值意图的菜
     */
    var _intentAddCache = {};
    function _analyzeIntentAddPositions(ruleIndex) {
        if (_intentAddCache.hasOwnProperty(ruleIndex)) {
            return _intentAddCache[ruleIndex];
        }
        var rule = _rules[ruleIndex];
        var result = { positionWeights: {}, hasIntentAdd: false, intentAddPositions: [] };
        
        if (!rule.IntentList || !_gameData || !_gameData.intents) {
            _intentAddCache[ruleIndex] = result;
            return result;
        }
        
        // 遍历每个厨师位置
        for (var ci = 0; ci < rule.IntentList.length; ci++) {
            var intentIds = rule.IntentList[ci];
            if (!intentIds) continue;
            
            var hasAdd = false;
            var otherIntentValue = 0; // 同位置其他意图的总价值
            
            for (var ii = 0; ii < intentIds.length; ii++) {
                for (var jj = 0; jj < _gameData.intents.length; jj++) {
                    if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                    var intent = _gameData.intents[jj];
                    
                    if (intent.effectType === 'IntentAdd') {
                        hasAdd = true;
                        result.hasIntentAdd = true;
                        result.intentAddPositions.push(ci);
                    } else if (!SATIETY_ONLY_EFFECTS[intent.effectType]) {
                        // 计算非饱食度意图的价值
                        var val = 0;
                        if (intent.effectType === 'PriceChangePercent' || intent.effectType === 'BasicPriceChangePercent') {
                            val = Math.abs(intent.effectValue || 0);
                        } else if (intent.effectType === 'BasicPriceChange') {
                            val = Math.abs(intent.effectValue || 0) / 5;
                        } else if (intent.effectType === 'CreateIntent' || intent.effectType === 'CreateBuff') {
                            val = 30;
                        }
                        otherIntentValue += val;
                    }
                    break;
                }
            }
            
            // 如果该位置有IntentAdd，权重 = 同位置其他意图价值（因为会被翻倍）
            if (hasAdd) {
                result.positionWeights[ci] = otherIntentValue;
            }
        }
        
        _intentAddCache[ruleIndex] = result;
        return result;
    }

    // ==================== 优化3: 售价光环厨师识别 ====================

    /**
     * 识别售价光环厨师（只识别售价光环，不识别技法值光环）
     * 售价光环: ultimateSkillEffect中condition=Partial且type以BasicPriceUse开头
     * 技法光环: ultimateSkillEffect中condition=Partial且type是Stirfry/Boil/Knife/Fry/Bake/Steam（排除）
     * 
     * 返回: [{chefId, chefName, auraEffects: [{type, value, condition}], auraScore}]
     */
    var _priceAuraChefCache = {};
    function _analyzePriceAuraChefs(ruleIndex) {
        if (_priceAuraChefCache.hasOwnProperty(ruleIndex)) {
            return _priceAuraChefCache[ruleIndex];
        }
        var rule = _rules[ruleIndex];
        var results = [];
        
        if (!rule.chefs) {
            _priceAuraChefCache[ruleIndex] = results;
            return results;
        }
        
        // 只有已修炼的厨师才有光环效果
        var partialChefIds = rule.calPartialChefIds || [];
        
        for (var ci = 0; ci < rule.chefs.length; ci++) {
            var chef = rule.chefs[ci];
            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
            if (!chef.ultimateSkillEffect) continue;
            
            // 检查是否在已修炼列表中（或全修炼模式）
            var isUltimated = (typeof isAllUltimateMode !== 'undefined' && isAllUltimateMode) || 
                              partialChefIds.indexOf(chef.chefId) >= 0;
            if (!isUltimated) continue;
            
            var auraEffects = [];
            var auraScore = 0;
            
            for (var ei = 0; ei < chef.ultimateSkillEffect.length; ei++) {
                var eff = chef.ultimateSkillEffect[ei];
                // 只要Partial条件的售价光环（BasicPriceUse开头）
                if (eff.condition === 'Partial' && eff.type && eff.type.indexOf('BasicPriceUse') === 0) {
                    auraEffects.push(eff);
                    auraScore += Math.abs(eff.value || 0);
                }
                // Next条件的售价光环也算（影响下一轮）
                if (eff.condition === 'Next' && eff.type && eff.type.indexOf('BasicPriceUse') === 0) {
                    auraEffects.push(eff);
                    auraScore += Math.abs(eff.value || 0) * 0.5; // 下一轮打折
                }
            }
            
            if (auraEffects.length > 0) {
                results.push({
                    chefId: chef.chefId,
                    chefName: chef.name,
                    auraEffects: auraEffects,
                    auraScore: auraScore
                });
            }
        }
        
        // 按光环分数降序
        results.sort(function(a, b) { return b.auraScore - a.auraScore; });
        
        _priceAuraChefCache[ruleIndex] = results;
        return results;
    }

    // ==================== 优化4: 品阶控制分析 ====================

    /**
     * 分析是否有特定品阶触发的高价值意图
     * 如果某个品阶（如特级=3）触发的意图价值很高，可能值得故意降低品阶
     * 
     * 返回: { preferredRanks: {rank: totalWeight}, hasRankPreference: boolean }
     */
    function _analyzeRankPreference(ruleIndex) {
        var rarityRankBonus = _analyzeRarityRankIntents(ruleIndex);
        var result = { preferredRanks: {}, hasRankPreference: false };
        
        // 如果有品阶加成意图，记录偏好
        for (var rank in rarityRankBonus.rankBonus) {
            if (rarityRankBonus.rankBonus[rank] > 0) {
                result.preferredRanks[rank] = rarityRankBonus.rankBonus[rank];
                result.hasRankPreference = true;
            }
        }
        
        return result;
    }

    // ==================== 厨师-菜谱协同分析 ====================

    var _synergyCache = {}; // ruleIndex -> [{chefId, recipeId, synergyScore, chefName, recipeName}]

    /**
     * 预计算厨师-菜谱协同加成对
     * 遍历每个厨师的 specialSkillEffect + selfUltimateEffect，
     * 对每道菜谱检查 isRecipePriceAddition / isRecipeBasicAddition 匹配度，
     * 生成高协同对列表（按协同分降序）
     */
    function _buildSynergyPairs(ruleIndex) {
        if (_synergyCache[ruleIndex]) return _synergyCache[ruleIndex];
        
        var rule = _rules[ruleIndex];
        var menus = _menusByRule[ruleIndex];
        var pairs = [];
        
        if (!rule.chefs || menus.length === 0) {
            _synergyCache[ruleIndex] = pairs;
            return pairs;
        }
        
        for (var ci = 0; ci < rule.chefs.length; ci++) {
            var chef = rule.chefs[ci];
            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
            
            // 收集厨师所有技能效果
            var allEffects = [];
            if (chef.specialSkillEffect) {
                for (var ei = 0; ei < chef.specialSkillEffect.length; ei++) {
                    allEffects.push(chef.specialSkillEffect[ei]);
                }
            }
            if (chef.selfUltimateEffect) {
                for (var ei = 0; ei < chef.selfUltimateEffect.length; ei++) {
                    allEffects.push(chef.selfUltimateEffect[ei]);
                }
            }
            
            if (allEffects.length === 0) continue;
            
            for (var mi = 0; mi < menus.length; mi++) {
                var rd = menus[mi];
                var synergyScore = 0;
                
                for (var ei = 0; ei < allEffects.length; ei++) {
                    var eff = allEffects[ei];
                    // 检查技能条件是否可能通过（简化检查，不需要完整recipes数组）
                    var condOk = true;
                    if (eff.conditionType) {
                        if (eff.conditionType === 'CookbookRarity') {
                            condOk = eff.conditionValueList && eff.conditionValueList.indexOf(rd.rarity) >= 0;
                        } else if (eff.conditionType === 'Rank') {
                            // Rank需要厨师和菜谱配合，假设可能通过
                            condOk = true;
                        } else if (eff.conditionType === 'CookbookTag') {
                            condOk = false;
                            if (eff.conditionValueList && rd.tags) {
                                for (var ti = 0; ti < eff.conditionValueList.length; ti++) {
                                    if (rd.tags.indexOf(eff.conditionValueList[ti]) >= 0) {
                                        condOk = true;
                                        break;
                                    }
                                }
                            }
                        } else if (eff.conditionType === 'ExcessCookbookNum' || eff.conditionType === 'FewerCookbookNum') {
                            condOk = true; // 份数条件，运行时才知道
                        } else if (eff.conditionType === 'SameSkill' || eff.conditionType === 'PerSkill') {
                            condOk = true; // 全局条件
                        } else if (eff.conditionType === 'ChefTag') {
                            condOk = true; // 厨师自身条件，总是通过
                        } else {
                            condOk = true;
                        }
                    }
                    if (!condOk) continue;
                    
                    var isPriceAdd = isRecipePriceAddition(eff, rd, rule);
                    var isBasicAdd = isRecipeBasicAddition(eff, rd);
                    
                    if (isPriceAdd) {
                        synergyScore += Math.abs(eff.value || 0);
                    }
                    if (isBasicAdd) {
                        // 基础加成按百分比估算影响（假设基础价100）
                        if (eff.type === 'BasicPrice') {
                            synergyScore += Math.abs(eff.value || 0) * 0.5;
                        } else {
                            synergyScore += Math.abs(eff.value || 0) * 0.3;
                        }
                    }
                }
                
                if (synergyScore > 0) {
                    // 加上菜谱基础价作为权重（高价菜+高协同=更好）
                    var weightedScore = synergyScore * (1 + (rd.price || 0) / 500);
                    pairs.push({
                        chefId: chef.chefId,
                        recipeId: rd.recipeId,
                        synergyScore: weightedScore,
                        chefName: chef.name,
                        recipeName: rd.name
                    });
                }
            }
        }
        
        pairs.sort(function(a, b) { return b.synergyScore - a.synergyScore; });
        // 保留top对（避免过多）
        if (pairs.length > 200) pairs.length = 200;
        
        _synergyCache[ruleIndex] = pairs;
        return pairs;
    }

    // ==================== 意图-技法绑定分析 ====================

    /**
     * 分析贵客意图中要求的技法，返回技法需求列表
     * 用于种子选择时优先匹配技法需求
     */
    function _analyzeIntentSkillRequirements(ruleIndex) {
        var rule = _rules[ruleIndex];
        var skillNeeds = {}; // {skillKey: weight}
        
        if (!rule.IntentList || !_gameData || !_gameData.intents) return skillNeeds;
        
        for (var ci = 0; ci < rule.IntentList.length; ci++) {
            var intentIds = rule.IntentList[ci];
            if (!intentIds) continue;
            
            for (var ii = 0; ii < intentIds.length; ii++) {
                for (var jj = 0; jj < _gameData.intents.length; jj++) {
                    if (_gameData.intents[jj].intentId !== intentIds[ii]) continue;
                    var intent = _gameData.intents[jj];
                    
                    if (intent.conditionType === 'CookSkill' && intent.conditionValue) {
                        var sk = intent.conditionValue.toLowerCase();
                        if (!skillNeeds[sk]) skillNeeds[sk] = 0;
                        // 分数类效果权重更高
                        if (!SATIETY_ONLY_EFFECTS[intent.effectType]) {
                            skillNeeds[sk] += 2;
                        } else {
                            skillNeeds[sk] += 0.5;
                        }
                    }
                    
                    // CreateIntent的子意图也检查
                    if (intent.effectType === 'CreateIntent') {
                        for (var kk = 0; kk < _gameData.intents.length; kk++) {
                            if (_gameData.intents[kk].intentId === intent.effectValue) {
                                var child = _gameData.intents[kk];
                                if (child.conditionType === 'CookSkill' && child.conditionValue) {
                                    var csk = child.conditionValue.toLowerCase();
                                    if (!skillNeeds[csk]) skillNeeds[csk] = 0;
                                    skillNeeds[csk] += 1.5;
                                }
                                break;
                            }
                        }
                    }
                    break;
                }
            }
        }
        
        return skillNeeds;
    }

    // ==================== 菜谱优先初始化 ====================

    function _generateInitialSolutionAsync(onProgress, onDone) {
        var activeRules = [];
        for (var ri = 0; ri < _rules.length; ri++) {
            if (_shouldProcessRule(ri)) activeRules.push(ri);
        }
        
        var candidates = [];
        var mainIdx = 0;
        // 细粒度进度 — 每个种子菜谱×厨师组合算一个子步
        // 每个位置有 recipeSeedK × chefPerSeed 个子步，协同种子有 maxSynergySeeds × numChefs 个子步
        var totalSubSteps = 0;
        var completedSubSteps = 0;
        for (var _ri = 0; _ri < activeRules.length; _ri++) {
            var _rule = _rules[activeRules[_ri]];
            var _nc = _rule.IntentList ? _rule.IntentList.length : 3;
            // 每个位置: recipeSeedK个种子 × chefPerSeed个厨师
            totalSubSteps += _nc * CONFIG.recipeSeedK * CONFIG.chefPerSeed;
            // 协同种子: 最多3对 × numChefs个位置
            totalSubSteps += Math.min(3, 200) * _nc; // 粗估，实际可能更少
        }
        
        function _updateInitProgress(bestCandidateScore) {
            // 初始化阶段目标进度 0-10%，通过匀速定时器平滑显示
            if (totalSubSteps > 0 && completedSubSteps > 0) {
                var pct = Math.max(1, Math.min(10, Math.round(10 * completedSubSteps / totalSubSteps)));
                _setProgressTarget(pct);
            }
        }
        
        function _getBestCandidateScore() {
            if (candidates.length === 0) return 0;
            var best = 0;
            for (var i = 0; i < candidates.length; i++) {
                if (candidates[i].score > best) best = candidates[i].score;
            }
            return best;
        }
        
        function _processNextRule() {
            if (mainIdx >= activeRules.length) {
                _finishInitialization(candidates, activeRules, onDone);
                return;
            }
            
            var mainRule = activeRules[mainIdx];
            var rule = _rules[mainRule];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            var gName = rule.Title || ('贵客' + (mainRule + 1));
            
            // 输出该贵客的调料/稀有度/品阶加成意图
            var condimentBonus = _analyzeCondimentIntents(mainRule);
            var rarityRankBonus = _analyzeRarityRankIntents(mainRule);
            var condimentList = [];
            var condimentNameMap = {'Spicy': '辣', 'Sweet': '甜', 'Sour': '酸', 'Salty': '咸', 'Bitter': '苦', 'Tasty': '鲜'};
            for (var cond in condimentBonus) {
                var condName = condimentNameMap[cond] || cond;
                condimentList.push(condName + ':' + condimentBonus[cond]);
            }
            var rarityList = [];
            for (var rar in rarityRankBonus.rarityBonus) {
                rarityList.push(rar + '火:' + rarityRankBonus.rarityBonus[rar]);
            }
            var rankList = [];
            var rankNames = {2: '优', 3: '特', 4: '神', 5: '传'};
            for (var rnk in rarityRankBonus.rankBonus) {
                rankList.push((rankNames[rnk] || rnk) + ':' + rarityRankBonus.rankBonus[rnk]);
            }
            if (condimentList.length > 0 || rarityList.length > 0 || rankList.length > 0) {
                if (condimentList.length > 0) {
                }
                if (rarityList.length > 0) {
                }
                if (rankList.length > 0) {
                }
            }
            
            // 输出技法加成意图
            var cookSkillBonus = _analyzeCookSkillIntents(mainRule);
            var skillNameMap = {'stirfry': '炒', 'fry': '炸', 'bake': '烤', 'steam': '蒸', 'boil': '煮', 'knife': '切'};
            var skillList = [];
            for (var sk in cookSkillBonus) {
                var skName = skillNameMap[sk] || sk;
                skillList.push(skName + ':' + cookSkillBonus[sk]);
            }
            if (skillList.length > 0) {
            }
            
            // 输出IntentAdd叠加信息
            var intentAddInfo = _analyzeIntentAddPositions(mainRule);
            if (intentAddInfo.hasIntentAdd) {
                var addPosList = [];
                for (var addPos in intentAddInfo.positionWeights) {
                    addPosList.push('位置' + (Number(addPos)+1) + '(价值' + intentAddInfo.positionWeights[addPos] + ')');
                }
            }
            
            // 输出售价光环厨师信息
            var priceAuraChefs = _analyzePriceAuraChefs(mainRule);
            if (priceAuraChefs.length > 0) {
                var auraList = priceAuraChefs.slice(0, 5).map(function(a) {
                    var types = a.auraEffects.map(function(e) { return e.type + '(' + e.value + ')'; });
                    return a.chefName + '[' + types.join(',') + ']分' + a.auraScore;
                });
            }
            
            // 输出品阶偏好信息
            var rankPref = _analyzeRankPreference(mainRule);
            if (rankPref.hasRankPreference) {
                var rankNames = {2: '优', 3: '特', 4: '神', 5: '传'};
                var prefList = [];
                for (var pr in rankPref.preferredRanks) {
                    prefList.push((rankNames[pr] || pr) + ':' + rankPref.preferredRanks[pr]);
                }
            }
            
            var phase2Info = [];
            for (var ci = 0; ci < numChefs; ci++) {
                phase2Info.push('pos' + (ci+1) + ':' + (_hasRecipeDependentIntents(mainRule, ci) ? '需Phase2' : '跳Phase2'));
            }
            var synergyPairs = _buildSynergyPairs(mainRule);
            var skillNeeds = _analyzeIntentSkillRequirements(mainRule);
            var skillNeedKeys = Object.keys(skillNeeds);
            if (synergyPairs.length > 0) {
            }
            if (skillNeedKeys.length > 0) {
            }
            
            // 位置循环和种子循环都改为异步，每步之间让出线程更新UI
            var seedPos = 0;
            
            function _processNextPosition() {
                if (seedPos >= numChefs) {
                    _processSynergySeeds();
                    return;
                }
                
                _updateInitProgress(_getBestCandidateScore());
                
                var intentStrategy = _analyzeIntents(mainRule, seedPos);
                var seedRecipeIdx = intentStrategy.seedRecipeIndex;
                var fillOrder = intentStrategy.fillOrder;
                
                if (intentStrategy.intentInfo) {
                }
                
                _initSimState();
                
                if (intentStrategy.prePlaceList.length > 0) {
                    for (var pp = 0; pp < intentStrategy.prePlaceList.length; pp++) {
                        var prePlace = intentStrategy.prePlaceList[pp];
                        var prePlaceRecipeId = _findBestFilteredRecipe(mainRule, seedPos, prePlace.recipeIndex, prePlace.filterFn);
                        if (prePlaceRecipeId) {
                            _simSetRecipe(mainRule, seedPos, prePlace.recipeIndex, prePlaceRecipeId);
                            var preName = _recipeMap[prePlaceRecipeId] ? _recipeMap[prePlaceRecipeId].name : '?';
                        }
                    }
                }
                
                var topRecipes = _fastGetRecipeRanking(mainRule, seedPos, seedRecipeIdx, CONFIG.recipeSeedK, true);
                
                // 种子菜谱循环改为异步，每个种子之间让出线程
                var rsi = 0;
                function _processNextSeedRecipe() {
                    if (rsi >= topRecipes.length) {
                        seedPos++;
                        _updateInitProgress(_getBestCandidateScore());
                        setTimeout(_processNextPosition, 0);
                        return;
                    }
                    
                    var seedRecipeName = _recipeMap[topRecipes[rsi].recipeId] ? _recipeMap[topRecipes[rsi].recipeId].name : '?';
                    
                    _initSimState();
                    
                    if (intentStrategy.prePlaceList.length > 0) {
                        for (var pp = 0; pp < intentStrategy.prePlaceList.length; pp++) {
                            var prePlace = intentStrategy.prePlaceList[pp];
                            var prePlaceRecipeId = _findBestFilteredRecipe(mainRule, seedPos, prePlace.recipeIndex, prePlace.filterFn);
                            if (prePlaceRecipeId) {
                                _simSetRecipe(mainRule, seedPos, prePlace.recipeIndex, prePlaceRecipeId);
                            }
                        }
                    }
                    
                    _simSetRecipe(mainRule, seedPos, seedRecipeIdx, topRecipes[rsi].recipeId);
                    var chefRanking = _fastGetChefRanking(mainRule, seedPos, true);
                    
                    var topChefNames = [];
                    for (var tc = 0; tc < Math.min(5, chefRanking.length); tc++) {
                        if (chefRanking[tc].skillOk !== false) {
                            topChefNames.push(_getChefNameById(chefRanking[tc].chefId) + '(' + chefRanking[tc].score + ')');
                        }
                    }
                    var chefsTried = 0;
                    for (var j = 0; j < chefRanking.length && chefsTried < CONFIG.chefPerSeed; j++) {
                        if (chefRanking[j].used || chefRanking[j].skillOk === false) continue;
                        chefsTried++;
                        
                        _initSimState();
                        
                        if (intentStrategy.prePlaceList.length > 0) {
                            for (var pp = 0; pp < intentStrategy.prePlaceList.length; pp++) {
                                var prePlace = intentStrategy.prePlaceList[pp];
                                var prePlaceRecipeId = _findBestFilteredRecipe(mainRule, seedPos, prePlace.recipeIndex, prePlace.filterFn);
                                if (prePlaceRecipeId) {
                                    _simSetRecipe(mainRule, seedPos, prePlace.recipeIndex, prePlaceRecipeId);
                                }
                            }
                        }
                        
                        _simSetRecipe(mainRule, seedPos, seedRecipeIdx, topRecipes[rsi].recipeId);
                        _simSetChef(mainRule, seedPos, chefRanking[j].chefId);
                        _greedyFillRecipesOrdered(mainRule, seedPos, fillOrder, seedRecipeIdx);
                        
                        for (var ci = 0; ci < numChefs; ci++) {
                            if (ci === seedPos) continue;
                            var otherStrategy = _analyzeIntents(mainRule, ci);
                            _greedyFillPositionWithIntent(mainRule, ci, otherStrategy);
                        }
                        
                        for (var otherIdx = 0; otherIdx < activeRules.length; otherIdx++) {
                            if (activeRules[otherIdx] === mainRule) continue;
                            _greedyFillGuestFullWithIntent(activeRules[otherIdx]);
                        }
                        
                        _quickRefineFast(activeRules, true);
                        
                        var score = _fastCalcScore();
                        var chefName = _getChefNameById(chefRanking[j].chefId);
                        candidates.push({
                            state: _cloneSimState(_simState),
                            score: score,
                            label: gName + '位置' + (seedPos+1) + '@pos' + (seedRecipeIdx+1) + ' ' + seedRecipeName + '+' + chefName
                        });
                        
                        // 候选生成后检查：分数达标且饱食度达标时提前结束
                        if (_targetScore && score >= _targetScore && _isAllSatietyOk()) {
                            _finishInitialization(candidates, activeRules, onDone);
                            return;
                        }
                        
                        completedSubSteps++;
                    }
                    
                    rsi++;
                    // 每个种子菜谱完成后确保进度增加（即使没有厨师被尝试）
                    completedSubSteps = Math.max(completedSubSteps, rsi * CONFIG.chefPerSeed);
                    // 每个种子菜谱之间让出线程，更新UI进度
                    _updateInitProgress(_getBestCandidateScore());
                    setTimeout(_processNextSeedRecipe, 0);
                }
                
                // 开始处理第一个种子菜谱
                setTimeout(_processNextSeedRecipe, 0);
            }
            
            function _processSynergySeeds() {
                if (synergyPairs.length > 0) {
                    var synergyTried = {};
                    var maxSynergySeeds = Math.min(3, synergyPairs.length);
                    
                    for (var spi = 0; spi < maxSynergySeeds; spi++) {
                        var sp = synergyPairs[spi];
                        var spKey = sp.chefId + '_' + sp.recipeId;
                        if (synergyTried[spKey]) continue;
                        synergyTried[spKey] = true;
                        
                        for (var synSeedPos = 0; synSeedPos < numChefs; synSeedPos++) {
                            
                            _initSimState();
                            
                            var synStrategy = _analyzeIntents(mainRule, synSeedPos);
                            var synSeedRecipeIdx = synStrategy.seedRecipeIndex;
                            
                            if (synStrategy.prePlaceList.length > 0) {
                                for (var spp = 0; spp < synStrategy.prePlaceList.length; spp++) {
                                    var synPrePlace = synStrategy.prePlaceList[spp];
                                    var synPreRecipeId = _findBestFilteredRecipe(mainRule, synSeedPos, synPrePlace.recipeIndex, synPrePlace.filterFn);
                                    if (synPreRecipeId) {
                                        _simSetRecipe(mainRule, synSeedPos, synPrePlace.recipeIndex, synPreRecipeId);
                                    }
                                }
                            }
                            
                            _simSetRecipe(mainRule, synSeedPos, synSeedRecipeIdx, sp.recipeId);
                            _simSetChef(mainRule, synSeedPos, sp.chefId);
                            
                            var synChefObj = _simState[mainRule][synSeedPos].chefObj;
                            var synRd = _recipeMap[sp.recipeId];
                            if (synChefObj && synRd) {
                                var synSkillFail = false;
                                if (synRd.stirfry > 0 && (!synChefObj.stirfryVal || synChefObj.stirfryVal < synRd.stirfry)) synSkillFail = true;
                                if (synRd.boil > 0 && (!synChefObj.boilVal || synChefObj.boilVal < synRd.boil)) synSkillFail = true;
                                if (synRd.knife > 0 && (!synChefObj.knifeVal || synChefObj.knifeVal < synRd.knife)) synSkillFail = true;
                                if (synRd.fry > 0 && (!synChefObj.fryVal || synChefObj.fryVal < synRd.fry)) synSkillFail = true;
                                if (synRd.bake > 0 && (!synChefObj.bakeVal || synChefObj.bakeVal < synRd.bake)) synSkillFail = true;
                                if (synRd.steam > 0 && (!synChefObj.steamVal || synChefObj.steamVal < synRd.steam)) synSkillFail = true;
                                if (synSkillFail) continue;
                            }
                            
                            _greedyFillRecipesOrdered(mainRule, synSeedPos, synStrategy.fillOrder, synSeedRecipeIdx);
                            
                            for (var synCi = 0; synCi < numChefs; synCi++) {
                                if (synCi === synSeedPos) continue;
                                var synOtherStrategy = _analyzeIntents(mainRule, synCi);
                                _greedyFillPositionWithIntent(mainRule, synCi, synOtherStrategy);
                            }
                            
                            for (var synOtherIdx = 0; synOtherIdx < activeRules.length; synOtherIdx++) {
                                if (activeRules[synOtherIdx] === mainRule) continue;
                                _greedyFillGuestFullWithIntent(activeRules[synOtherIdx]);
                            }
                            
                            _quickRefineFast(activeRules, true);
                            
                            var synScore = _fastCalcScore();
                            candidates.push({
                                state: _cloneSimState(_simState),
                                score: synScore,
                                label: gName + '协同pos' + (synSeedPos+1) + ' ' + sp.chefName + '+' + sp.recipeName + '(syn:' + sp.synergyScore.toFixed(0) + ')'
                            });
                            
                            // 协同种子检查：分数达标且饱食度达标时提前结束
                            if (_targetScore && synScore >= _targetScore && _isAllSatietyOk()) {
                                _finishInitialization(candidates, activeRules, onDone);
                                return;
                            }
                            
                            // 协同种子每个位置完成后更新子步进度
                            completedSubSteps++;
                        }
                    }
                }
                
                _updateInitProgress(_getBestCandidateScore());
                
                // 处理售价光环厨师种子
                _processAuraChefSeeds();
            }
            
            // ==================== 售价光环厨师种子生成 ====================
            function _processAuraChefSeeds() {
                var auraChefs = _analyzePriceAuraChefs(mainRule);
                if (auraChefs.length === 0) {
                    _processMultiSkillSeeds();
                    return;
                }
                
                // 最多尝试top3光环厨师
                var maxAuraSeeds = Math.min(3, auraChefs.length);
                var auraTried = {};
                
                for (var ai = 0; ai < maxAuraSeeds; ai++) {
                    var auraChef = auraChefs[ai];
                    if (auraTried[auraChef.chefId]) continue;
                    auraTried[auraChef.chefId] = true;
                    
                    // 光环厨师放在每个位置都试一次（光环是Partial，影响全场）
                    for (var auraPos = 0; auraPos < numChefs; auraPos++) {
                        _initSimState();
                        
                        // 先设置光环厨师
                        _simSetChef(mainRule, auraPos, auraChef.chefId);
                        
                        // 用意图感知策略填充该位置的菜谱
                        var auraStrategy = _analyzeIntents(mainRule, auraPos);
                        if (auraStrategy.prePlaceList.length > 0) {
                            for (var pp = 0; pp < auraStrategy.prePlaceList.length; pp++) {
                                var prePlace = auraStrategy.prePlaceList[pp];
                                var prePlaceRecipeId = _findBestFilteredRecipe(mainRule, auraPos, prePlace.recipeIndex, prePlace.filterFn);
                                if (prePlaceRecipeId) _simSetRecipe(mainRule, auraPos, prePlace.recipeIndex, prePlaceRecipeId);
                            }
                        }
                        var auraRk = _fastGetRecipeRanking(mainRule, auraPos, auraStrategy.seedRecipeIndex, 1, true);
                        if (auraRk.length > 0) _simSetRecipe(mainRule, auraPos, auraStrategy.seedRecipeIndex, auraRk[0].recipeId);
                        _greedyFillRecipesOrdered(mainRule, auraPos, auraStrategy.fillOrder, auraStrategy.seedRecipeIndex);
                        
                        // 填充其他位置
                        for (var aci = 0; aci < numChefs; aci++) {
                            if (aci === auraPos) continue;
                            var auraOtherStrategy = _analyzeIntents(mainRule, aci);
                            _greedyFillPositionWithIntent(mainRule, aci, auraOtherStrategy);
                        }
                        
                        // 填充其他贵客
                        for (var aOtherIdx = 0; aOtherIdx < activeRules.length; aOtherIdx++) {
                            if (activeRules[aOtherIdx] === mainRule) continue;
                            _greedyFillGuestFullWithIntent(activeRules[aOtherIdx]);
                        }
                        
                        _quickRefineFast(activeRules, true);
                        
                        var auraScore = _fastCalcScore();
                        candidates.push({
                            state: _cloneSimState(_simState),
                            score: auraScore,
                            label: gName + '光环(' + auraChef.chefName + ')pos' + (auraPos+1)
                        });
                        
                        if (_targetScore && auraScore >= _targetScore && _isAllSatietyOk()) {
                            _finishInitialization(candidates, activeRules, onDone);
                            return;
                        }
                        
                        completedSubSteps++;
                    }
                }
                
                _updateInitProgress(_getBestCandidateScore());
                
                // 处理多技法组合种子
                _processMultiSkillSeeds();
            }
            
            // ==================== 多技法组合种子生成 ====================
            function _processMultiSkillSeeds() {
                var threeSkillIntents = _analyzeThreeSkillIntents(mainRule);
                
                // 只有当存在2个以上"三道某技法"意图时才生成多技法组合种子
                if (threeSkillIntents.length < 2) {
                    // 没有多技法意图，直接进入下一个贵客
                    mainIdx++;
                    setTimeout(_processNextRule, 0);
                    return;
                }
                
                var skillCombinations = _generateMultiSkillCombinations(threeSkillIntents);
                
                // 只处理双技法和三技法组合（单技法已在普通种子中覆盖）
                var multiSkillCombos = [];
                for (var ci = 0; ci < skillCombinations.length; ci++) {
                    if (skillCombinations[ci].skills.length >= 2) {
                        multiSkillCombos.push(skillCombinations[ci]);
                    }
                }
                
                // 按技法数量排序：双技法优先（更容易找到满足条件的菜谱）
                multiSkillCombos.sort(function(a, b) {
                    // 先按技法数量升序（双技法优先）
                    if (a.skills.length !== b.skills.length) {
                        return a.skills.length - b.skills.length;
                    }
                    // 同技法数量按权重降序
                    return b.totalWeight - a.totalWeight;
                });
                
                if (multiSkillCombos.length === 0) {
                    mainIdx++;
                    setTimeout(_processNextRule, 0);
                    return;
                }
                
                // 限制最多处理4个组合（优先双技法）
                if (multiSkillCombos.length > 4) multiSkillCombos.length = 4;
                
                var comboIdx = 0;
                
                function _processNextCombo() {
                    if (comboIdx >= multiSkillCombos.length) {
                        // 所有组合处理完成，进入下一个贵客
                        mainIdx++;
                        setTimeout(_processNextRule, 0);
                        return;
                    }
                    
                    var combo = multiSkillCombos[comboIdx];
                    var comboSkillNames = combo.skillNames.join('+');
                    
                    // 筛选同时具有这些技法的菜谱（会考虑调料/稀有度/品阶加成）
                    var multiSkillRecipes = _filterRecipesByMultiSkills(mainRule, combo.skills);
                    
                    // 显示识别到的加成意图
                    if (comboIdx === 0) {
                        var condimentBonus = _analyzeCondimentIntents(mainRule);
                        var rarityRankBonus = _analyzeRarityRankIntents(mainRule);
                        var condimentList = [];
                        for (var cond in condimentBonus) {
                            condimentList.push(cond + ':' + condimentBonus[cond]);
                        }
                        var rarityList = [];
                        for (var rar in rarityRankBonus.rarityBonus) {
                            rarityList.push(rar + '火:' + rarityRankBonus.rarityBonus[rar]);
                        }
                        var rankList = [];
                        var rankNames = {2: '优', 3: '特', 4: '神', 5: '传'};
                        for (var rnk in rarityRankBonus.rankBonus) {
                            rankList.push((rankNames[rnk] || rnk) + ':' + rarityRankBonus.rankBonus[rnk]);
                        }
                    }
                    
                    if (multiSkillRecipes.length < 3) {
                        // 满足条件的菜谱不足3道，跳过此组合
                        comboIdx++;
                        setTimeout(_processNextCombo, 0);
                        return;
                    }
                    
                    // 取前10道菜谱作为候选池（用于厨师技能不足时回退）
                    var topMultiRecipes = multiSkillRecipes.slice(0, Math.min(10, multiSkillRecipes.length));
                    
                    // 为每个厨师位置尝试多技法组合
                    for (var msPos = 0; msPos < numChefs; msPos++) {
                        _initSimState();
                        
                        // 尝试找到厨师能做的3道多技法菜谱组合
                        var msChefSet = false;
                        var bestChefId = null;
                        var bestRecipeSet = null;
                        
                        // 策略：遍历厨师，找到能做最多高价多技法菜谱的厨师
                        var rule = _rules[mainRule];
                        var msUsedChefIds = _getUsedChefIds(mainRule, msPos);
                        
                        for (var chefIdx = 0; chefIdx < rule.chefs.length && !msChefSet; chefIdx++) {
                            var chef = rule.chefs[chefIdx];
                            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
                            if (msUsedChefIds[chef.chefId]) continue;
                            
                            // 临时设置厨师来检查技能
                            _simSetChef(mainRule, msPos, chef.chefId);
                            var chefObj = _simState[mainRule][msPos].chefObj;
                            
                            // 找出这个厨师能做的多技法菜谱
                            var canMakeRecipes = [];
                            for (var ri = 0; ri < topMultiRecipes.length && canMakeRecipes.length < 3; ri++) {
                                var recipe = topMultiRecipes[ri];
                                // 检查厨师技能是否足够做这道菜
                                var tempChef = JSON.parse(JSON.stringify(chefObj));
                                addCheffSkillDiff(tempChef, recipe);
                                var diff = getChefSillDiff(tempChef, chefObj);
                                if (diff === "") {
                                    canMakeRecipes.push(recipe);
                                }
                            }
                            
                            // 如果能做3道菜，就用这个厨师
                            if (canMakeRecipes.length >= 3) {
                                bestChefId = chef.chefId;
                                bestRecipeSet = canMakeRecipes.slice(0, 3);
                                msChefSet = true;
                            }
                        }
                        
                        if (!msChefSet) {
                            continue;
                        }
                        
                        // 分析"下道料理"和"下阶段"意图，用于优化菜谱位置分配
                        var nextDishIntents = _analyzeNextDishIntents(mainRule, msPos);
                        
                        // 设置找到的厨师和菜谱
                        _simSetChef(mainRule, msPos, bestChefId);
                        var usedRecipeIds = {};
                        
                        // 智能分配菜谱位置：能触发"下道料理"意图的菜不放最后一位
                        if (nextDishIntents.length > 0 && bestRecipeSet.length >= 3) {
                            // 计算每道菜能触发的"下道料理"意图权重
                            var recipeWithWeight = [];
                            for (var rwi = 0; rwi < bestRecipeSet.length; rwi++) {
                                var triggerWeight = _canTriggerNextDishIntent(bestRecipeSet[rwi], nextDishIntents);
                                recipeWithWeight.push({
                                    recipe: bestRecipeSet[rwi],
                                    triggerWeight: triggerWeight
                                });
                            }
                            
                            // 按触发权重升序排序（权重低的放后面，权重高的放前面）
                            recipeWithWeight.sort(function(a, b) { return b.triggerWeight - a.triggerWeight; });
                            
                            // 分配位置：权重高的放位置0和1，权重最低的放位置2
                            for (var reci = 0; reci < 3; reci++) {
                                var assignRecipe = recipeWithWeight[reci].recipe;
                                _simSetRecipe(mainRule, msPos, reci, assignRecipe.recipeId);
                                usedRecipeIds[assignRecipe.recipeId] = true;
                            }
                        } else {
                            // 没有下道料理意图，按原顺序分配
                            for (var reci = 0; reci < bestRecipeSet.length; reci++) {
                                _simSetRecipe(mainRule, msPos, reci, bestRecipeSet[reci].recipeId);
                                usedRecipeIds[bestRecipeSet[reci].recipeId] = true;
                            }
                        }
                        
                        // 填充其他厨师位置
                        for (var otherCi = 0; otherCi < numChefs; otherCi++) {
                            if (otherCi === msPos) continue;
                            
                            // 收集已使用的菜谱ID
                            var otherUsedIds = {};
                            for (var ori = 0; ori < _simState[mainRule].length; ori++) {
                                for (var oreci = 0; oreci < 3; oreci++) {
                                    var orec = _simState[mainRule][ori].recipes[oreci];
                                    if (orec.data) otherUsedIds[orec.data.recipeId] = true;
                                }
                            }
                            
                            // 先选厨师，再根据厨师技能选菜谱
                            var otherUsedChefIds = _getUsedChefIds(mainRule, otherCi);
                            var otherChefSet = false;
                            
                            for (var oci = 0; oci < rule.chefs.length && !otherChefSet; oci++) {
                                var otherChef = rule.chefs[oci];
                                if (_cachedConfig.useGot && !otherChef.got && !isAllUltimateMode) continue;
                                if (otherUsedChefIds[otherChef.chefId]) continue;
                                
                                _simSetChef(mainRule, otherCi, otherChef.chefId);
                                var otherChefObj = _simState[mainRule][otherCi].chefObj;
                                
                                // 找这个厨师能做的多技法菜谱
                                var otherCanMake = [];
                                for (var mri = 0; mri < multiSkillRecipes.length && otherCanMake.length < 3; mri++) {
                                    var mRecipe = multiSkillRecipes[mri];
                                    if (otherUsedIds[mRecipe.recipeId]) continue;
                                    
                                    var tempChef2 = JSON.parse(JSON.stringify(otherChefObj));
                                    addCheffSkillDiff(tempChef2, mRecipe);
                                    var diff2 = getChefSillDiff(tempChef2, otherChefObj);
                                    if (diff2 === "") {
                                        otherCanMake.push(mRecipe);
                                    }
                                }
                                
                                // 如果能做至少1道多技法菜谱，就用这个厨师
                                if (otherCanMake.length > 0) {
                                    otherChefSet = true;
                                    // 设置能做的多技法菜谱
                                    for (var oreci = 0; oreci < otherCanMake.length; oreci++) {
                                        _simSetRecipe(mainRule, otherCi, oreci, otherCanMake[oreci].recipeId);
                                        otherUsedIds[otherCanMake[oreci].recipeId] = true;
                                    }
                                    // 剩余位置用普通排名填充
                                    for (var oreci = otherCanMake.length; oreci < 3; oreci++) {
                                        var fallbackRanking = _fastGetRecipeRanking(mainRule, otherCi, oreci, 5, true);
                                        for (var fri = 0; fri < fallbackRanking.length; fri++) {
                                            if (!otherUsedIds[fallbackRanking[fri].recipeId]) {
                                                _simSetRecipe(mainRule, otherCi, oreci, fallbackRanking[fri].recipeId);
                                                otherUsedIds[fallbackRanking[fri].recipeId] = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // 如果没找到能做多技法菜谱的厨师，用普通贪心填充
                            if (!otherChefSet) {
                                var otherStrategy = _analyzeIntents(mainRule, otherCi);
                                _greedyFillPositionWithIntent(mainRule, otherCi, otherStrategy);
                            }
                        }
                        
                        // 填充其他贵客
                        for (var otherRuleIdx = 0; otherRuleIdx < activeRules.length; otherRuleIdx++) {
                            if (activeRules[otherRuleIdx] === mainRule) continue;
                            _greedyFillGuestFullWithIntent(activeRules[otherRuleIdx]);
                        }
                        
                        // 精调
                        _quickRefineFast(activeRules, true);
                        
                        var msScore = _fastCalcScore();
                        candidates.push({
                            state: _cloneSimState(_simState),
                            score: msScore,
                            label: gName + '多技法(' + comboSkillNames + ')pos' + (msPos+1)
                        });
                        
                        // 检查是否达标
                        if (_targetScore && msScore >= _targetScore && _isAllSatietyOk()) {
                            _finishInitialization(candidates, activeRules, onDone);
                            return;
                        }
                        
                        completedSubSteps++;
                    }
                    
                    comboIdx++;
                    _updateInitProgress(_getBestCandidateScore());
                    setTimeout(_processNextCombo, 0);
                }
                
                // 开始处理第一个组合
                setTimeout(_processNextCombo, 0);
            }
            
            // 开始处理第一个位置
            setTimeout(_processNextPosition, 0);
        }
        
        // 开始处理第一个贵客
        setTimeout(_processNextRule, 0);
    }
    
    /**
     * 初始化完成：排序候选、精调、选出最佳
     * 候选已达标时跳过精调直接返回
     */
    function _finishInitialization(candidates, activeRules, onDone) {
        candidates.sort(function(a, b) { return b.score - a.score; });
        
        for (var t = 0; t < Math.min(5, candidates.length); t++) {
        }
        
        if (candidates.length > 0) {
            _topCandidates = [];
            var numTop = Math.min(5, candidates.length);
            for (var t = 0; t < numTop; t++) {
                _topCandidates.push(_cloneSimState(candidates[t].state));
            }
            
            // 候选分数达标时的处理
            if (_targetScore && candidates[0].score >= _targetScore) {
                _simState = _cloneSimState(_topCandidates[0]);
                _bestScore = candidates[0].score;
                _bestSimState = _cloneSimState(_simState);
                
                if (_isAllSatietyOk()) {
                    // 分数和饱食度都达标，直接返回
                    if (typeof onDone === 'function') onDone();
                    return;
                } else {
                    // 分数达标但饱食度不达标
                    if (_isSatietyDiffAcceptable()) {
                        // 饱食度差值<=2，执行爬山优化
                        _runClimbingPhase(0, function() {
                            // 爬山后再次检查
                            if (_isTargetReachedWithSatiety()) {
                                // 达标则返回
                                if (typeof onDone === 'function') onDone();
                                return;
                            }
                            // 不达标则继续精调流程
                            _continueRefineProcess();
                        });
                        return;
                    } else {
                        // 饱食度差值>2，跳过爬山，直接继续精调流程
                        _continueRefineProcess();
                        return;
                    }
                }
            }
            
            // 分数未达标，继续精调
            _continueRefineProcess();
            
            function _continueRefineProcess() {
            
            _simState = candidates[0].state;
            var activeRulesForRefine = [];
            for (var ri = 0; ri < _rules.length; ri++) {
                if (_shouldProcessRule(ri)) activeRulesForRefine.push(ri);
            }
            _quickRefineFast(activeRulesForRefine, false);
            var refinedScore = _fastCalcScore();
            _topCandidates[0] = _cloneSimState(_simState);
            
            // 精调后检查：分数达标时的处理
            if (_targetScore && refinedScore >= _targetScore) {
                _simState = _cloneSimState(_topCandidates[0]);
                _bestScore = refinedScore;
                _bestSimState = _cloneSimState(_simState);
                
                if (_isAllSatietyOk()) {
                    // 分数和饱食度都达标，直接返回
                    if (typeof onDone === 'function') onDone();
                    return;
                } else {
                    // 分数达标但饱食度不达标
                    if (_isSatietyDiffAcceptable()) {
                        // 饱食度差值<=2，执行爬山优化
                        _runClimbingPhase(0, function() {
                            // 爬山后再次检查
                            if (_isTargetReachedWithSatiety()) {
                                // 达标则返回
                                if (typeof onDone === 'function') onDone();
                                return;
                            }
                            // 不达标则继续其他候选精调
                            _continueOtherCandidates();
                        });
                        return;
                    } else {
                        _continueOtherCandidates();
                        return;
                    }
                }
            }
            
            // 分数未达标，继续其他候选精调
            _continueOtherCandidates();
            
            function _continueOtherCandidates() {
            
            var totalMenusInit = 0;
            for (var mi = 0; mi < _menusByRule.length; mi++) totalMenusInit += _menusByRule[mi].length;
            var seedRefineMode = totalMenusInit > 800 ? true : false;
            
            for (var t = 1; t < _topCandidates.length; t++) {
                _simState = _topCandidates[t];
                _quickRefineFast(activeRulesForRefine, seedRefineMode);
                var tScore = _fastCalcScore();
                _topCandidates[t] = _cloneSimState(_simState);
                if (tScore > refinedScore) {
                    _topCandidates[0] = _topCandidates[t];
                    refinedScore = tScore;
                }
            }
            
            _simState = _cloneSimState(_topCandidates[0]);
        
        if (typeof onDone === 'function') onDone();
            } // end _continueOtherCandidates
            } // end _continueRefineProcess
        }
        
    }
    
    /**
     * 快速精调（全用fastMode，逐贵客独立优化）
     * 每个贵客内部：菜谱→厨师→菜谱 交替，迭代直到收敛
     * lightMode: 只精调菜谱不精调厨师（更快）
     * 饱食度感知 — 最后一轮检查饱食度偏差，尝试微调
     */
    function _quickRefineFast(activeRules, lightMode) {
        // lightMode可以是boolean或数字
        // true/1 = 1轮只调菜谱, false = CONFIG.refineIter轮, 数字N = N轮含厨师
        var maxIter, skipChef;
        if (lightMode === true || lightMode === 1) {
            maxIter = 1;
            skipChef = true;
        } else if (typeof lightMode === 'number' && lightMode > 1) {
            maxIter = lightMode;
            skipChef = false;
        } else {
            maxIter = CONFIG.refineIter;
            skipChef = false;
        }
        for (var iter = 0; iter < maxIter; iter++) {
            var changed = false;
            for (var ri = 0; ri < activeRules.length; ri++) {
                var ruleIndex = activeRules[ri];
                var rule = _rules[ruleIndex];
                var numChefs = rule.IntentList ? rule.IntentList.length : 3;
                
                for (var ci = 0; ci < numChefs; ci++) {
                    // 菜谱
                    for (var reci = 0; reci < 3; reci++) {
                        var curId = _simState[ruleIndex][ci].recipes[reci].data 
                            ? _simState[ruleIndex][ci].recipes[reci].data.recipeId : null;
                        var rk = _fastGetRecipeRanking(ruleIndex, ci, reci, 1, true);
                        if (rk.length > 0 && rk[0].recipeId !== curId) {
                            _simSetRecipe(ruleIndex, ci, reci, rk[0].recipeId);
                            changed = true;
                        }
                    }
                    if (skipChef) continue; // 轻量模式跳过厨师精调
                    // 厨师
                    var curChef = _simState[ruleIndex][ci].chefId;
                    var ck = _fastGetChefRanking(ruleIndex, ci, true);
                    var usedIds = _getUsedChefIds(ruleIndex, ci);
                    for (var j = 0; j < ck.length; j++) {
                        if (!ck[j].used && !usedIds[ck[j].chefId] && ck[j].skillOk !== false) {
                            if (ck[j].chefId !== curChef) {
                                _simSetChef(ruleIndex, ci, ck[j].chefId);
                                changed = true;
                            }
                            break;
                        }
                    }
                    // 菜谱二次（厨师变了可能影响）
                    for (var reci = 0; reci < 3; reci++) {
                        var curId2 = _simState[ruleIndex][ci].recipes[reci].data 
                            ? _simState[ruleIndex][ci].recipes[reci].data.recipeId : null;
                        var rk2 = _fastGetRecipeRanking(ruleIndex, ci, reci, 1, true);
                        if (rk2.length > 0 && rk2[0].recipeId !== curId2) {
                            _simSetRecipe(ruleIndex, ci, reci, rk2[0].recipeId);
                            changed = true;
                        }
                    }
                }
            }
            if (!changed) break;
        }
        
        // 饱食度感知微调（非轻量模式时执行）
        if (!skipChef) {
            _satietyAwareAdjust(activeRules);
        }
    }
    
    /**
     * 饱食度感知微调
     * 检查每个贵客的饱食度偏差，如果偏差大，尝试替换菜谱来接近目标饱食度
     * 不同稀有度菜谱的饱食度不同（rarity就是satiety基础值），高稀有度=高饱食度
     */
    function _satietyAwareAdjust(activeRules) {
        for (var ri = 0; ri < activeRules.length; ri++) {
            var ruleIndex = activeRules[ri];
            var rule = _rules[ruleIndex];
            if (!rule.Satiety) continue;
            
            var ruleState = _simState[ruleIndex];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            
            // 计算当前饱食度
            var currentSatiety = _calcCurrentSatiety(ruleIndex);
            var targetSatiety = rule.Satiety;
            var diff = currentSatiety - targetSatiety;
            
            // 如果偏差不大（±2以内），不调整
            if (Math.abs(diff) <= 2) continue;
            
            // 当前分数作为基准
            var baseScore = _fastCalcScore();
            
            // 优化6: 增强饱食度管理
            // 策略1: 尝试替换菜谱来改善饱食度（允许小幅分数损失换取饱食度达标）
            var bestAdjScore = baseScore;
            var bestAdjState = null;
            var bestAdjSatDiff = Math.abs(diff);
            // 允许的最大分数损失比例（饱食度达标的奖励很大，值得小幅牺牲）
            var maxScoreLoss = baseScore * 0.02; // 允许2%分数损失
            
            for (var ci = 0; ci < numChefs; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    var curRec = ruleState[ci].recipes[reci];
                    if (!curRec.data) continue;
                    
                    // 获取更多候选菜谱（扩大搜索范围）
                    var adjCandidates = _fastGetRecipeRanking(ruleIndex, ci, reci, 10, true);
                    
                    for (var candi = 0; candi < adjCandidates.length; candi++) {
                        if (adjCandidates[candi].recipeId === curRec.data.recipeId) continue;
                        var candRd = _recipeMap[adjCandidates[candi].recipeId];
                        if (!candRd) continue;
                        
                        // 临时替换并评估
                        var savedRecipe = ruleState[ci].recipes[reci];
                        _simSetRecipe(ruleIndex, ci, reci, adjCandidates[candi].recipeId);
                        var adjScore = _fastCalcScore();
                        var newSat = _calcCurrentSatiety(ruleIndex);
                        var newSatDiff = Math.abs(newSat - targetSatiety);
                        
                        // 接受条件：
                        // 1. 分数更高（无条件接受）
                        // 2. 分数略低但饱食度显著改善（允许小幅损失）
                        var accept = false;
                        if (adjScore > bestAdjScore) {
                            accept = true;
                        } else if (newSatDiff < bestAdjSatDiff && adjScore >= baseScore - maxScoreLoss) {
                            // 饱食度改善且分数损失在可接受范围内
                            accept = true;
                        }
                        
                        if (accept) {
                            bestAdjScore = adjScore;
                            bestAdjState = {ri: ruleIndex, ci: ci, reci: reci, recipeId: adjCandidates[candi].recipeId};
                            bestAdjSatDiff = newSatDiff;
                        }
                        
                        // 恢复
                        ruleState[ci].recipes[reci] = savedRecipe;
                    }
                }
            }
            
            // 应用最佳饱食度调整
            if (bestAdjState) {
                _simSetRecipe(bestAdjState.ri, bestAdjState.ci, bestAdjState.reci, bestAdjState.recipeId);
                var newSatiety = _calcCurrentSatiety(ruleIndex);
            }
        }
    }
    
    /**
     * 计算某个rule当前的总饱食度
     * 注意：必须与_calcRuleScore中的饱食度计算逻辑保持一致
     */
    function _calcCurrentSatiety(ruleIndex) {
        var ruleState = _simState[ruleIndex];
        // 先调用_calcRuleScore确保satiety值被计算
        _calcRuleScore(ruleIndex, true);
        var total = 0;
        var details = [];
        for (var ci = 0; ci < ruleState.length; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = ruleState[ci].recipes[reci];
                if (rec.data) {
                    // 与_calcRuleScore保持一致：只使用rec.satiety，不使用rarity作为fallback
                    var satVal = rec.satiety || 0;
                    total += satVal;
                    var recName = rec.data.name || '未知';
                    var satietyInfo = rec.satiety ? rec.satiety : '0(未设置)';
                    details.push('厨师' + (ci+1) + '菜' + (reci+1) + '[' + recName + ']:' + satietyInfo);
                }
            }
        }
        return total;
    }

    function _tryIncreaseOnePortionUntilTarget() {
        var bestStep = null;
        var baseScore = _fastCalcScore();
        var bestDistance = Infinity;   // 与目标分的绝对差值（越小越好）
        var bestDelta = Infinity;      // 本次补份带来的分数增量（越小越好）
        var bestOvershoot = Infinity;  // 超出目标分的幅度（越小越好）

        for (var ri = 0; ri < _rules.length; ri++) {
            if (!_shouldProcessRule(ri)) continue;
            for (var ci = 0; ci < _simState[ri].length; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    var rec = _simState[ri][ci].recipes[reci];
                    if (!rec.data || rec.quantity >= rec.max) continue;

                    rec.quantity += 1;
                    var score = _fastCalcScore();
                    var distance = Math.abs(_targetScore - score);
                    var delta = Math.abs(score - baseScore);
                    var overshoot = score >= _targetScore ? (score - _targetScore) : Infinity;

                    if (distance < bestDistance ||
                        (distance === bestDistance && delta < bestDelta) ||
                        (distance === bestDistance && delta === bestDelta && overshoot < bestOvershoot)) {
                        bestDistance = distance;
                        bestDelta = delta;
                        bestOvershoot = overshoot;
                        bestStep = {ri: ri, ci: ci, reci: reci};
                    }

                    rec.quantity -= 1;
                }
            }
        }

        if (!bestStep) return false;
        _simState[bestStep.ri][bestStep.ci].recipes[bestStep.reci].quantity += 1;
        return true;
    }

    function _compressQuantitiesForTarget() {
        if (!_targetScore) return;
        
        var changed = true;
        while (changed) {
            changed = false;
            for (var ri = 0; ri < _rules.length; ri++) {
                if (!_shouldProcessRule(ri)) continue;
                for (var ci = 0; ci < _simState[ri].length; ci++) {
                    for (var reci = 0; reci < 3; reci++) {
                        var rec = _simState[ri][ci].recipes[reci];
                        if (!rec.data || rec.quantity <= 1) continue;
                        
                        rec.quantity -= 1;
                        var score = _fastCalcScore();
                        var satOk = _isAllSatietyOk();
                        if (score >= _targetScore && satOk) {
                            changed = true;
                        } else {
                            rec.quantity += 1;
                        }
                    }
                }
            }
        }
    }

    function _isCurrentStateTargetReachedWithSatiety() {
        if (!_targetScore) return _isAllSatietyOk();
        return _fastCalcScore() >= _targetScore && _isAllSatietyOk();
    }

    function _finalizeTargetQuantities() {
        if (!_targetScore || !_bestSimState || _getActiveQuantityMode() !== 'single') return;
        
        var savedState = _cloneSimState(_bestSimState);
        var savedScore = _bestScore;
        var savedMode = _quantitySearchMode;
        
        _simState = _cloneSimState(_bestSimState);
        _quantitySearchMode = 'full';
        _fastCalcScore(); // 刷新每道菜的max
        
        var maxSteps = 999;
        var steps = 0;
        while (!_isCurrentStateTargetReachedWithSatiety() && steps < maxSteps) {
            if (!_tryIncreaseOnePortionUntilTarget()) break;
            steps++;
        }
        
        if (_isCurrentStateTargetReachedWithSatiety()) {
            _compressQuantitiesForTarget();
            _bestSimState = _cloneSimState(_simState);
            _bestScore = _fastCalcScore();
        } else {
            _bestSimState = savedState;
            _bestScore = savedScore;
            _simState = _cloneSimState(savedState);
            _quantitySearchMode = savedMode;
            return;
        }
        
        _quantitySearchMode = savedMode;
        _simState = _cloneSimState(_bestSimState);
    }
    

    /**
     * 在菜谱列表中找满足过滤条件的最佳菜谱（用于链式意图预放置）
     * 使用快速排名，但只从满足filterFn的菜谱中选
     */
    function _findBestFilteredRecipe(ruleIndex, chefIndex, recipeIndex, filterFn) {
        var menus = _menusByRule[ruleIndex];
        var ruleState = _simState[ruleIndex];
        
        // 收集已用菜谱
        var usedRecipeIds = {};
        for (var ri = 0; ri < _simState.length; ri++) {
            for (var ci = 0; ci < _simState[ri].length; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    if (ri === ruleIndex && ci === chefIndex && reci === recipeIndex) continue;
                    var rec = _simState[ri][ci].recipes[reci];
                    if (rec.data) usedRecipeIds[rec.data.recipeId] = true;
                }
            }
        }
        
        // 简单策略：从满足条件的菜谱中选价格最高的（无厨师时无法精确评分）
        var bestRecipe = null;
        var bestPrice = -1;
        
        for (var i = 0; i < menus.length; i++) {
            var rd = menus[i];
            if (usedRecipeIds[rd.recipeId]) continue;
            if (!filterFn(rd)) continue;
            
            var price = rd.price || 0;
            if (price > bestPrice) {
                bestPrice = price;
                bestRecipe = rd;
            }
        }
        
        return bestRecipe ? bestRecipe.recipeId : null;
    }

    /**
     * 按指定顺序贪心填充菜谱（跳过已有菜谱的位置和种子位置）
     */
    function _greedyFillRecipesOrdered(ruleIndex, chefIndex, fillOrder, seedRecipeIdx) {
        for (var fi = 0; fi < fillOrder.length; fi++) {
            var recipeIndex = fillOrder[fi];
            if (recipeIndex === seedRecipeIdx) continue; // 种子位置已填
            if (_simState[ruleIndex][chefIndex].recipes[recipeIndex].data) continue; // 预放置的位置已填
            
            var ranking = _fastGetRecipeRanking(ruleIndex, chefIndex, recipeIndex, 1, true);
            if (ranking.length > 0) {
                _simSetRecipe(ruleIndex, chefIndex, recipeIndex, ranking[0].recipeId);
            }
        }
    }

    /**
     * 用意图感知策略填充一个厨师位置（菜谱+厨师+剩余菜谱）
     */
    function _greedyFillPositionWithIntent(ruleIndex, chefIndex, intentStrategy) {
        var fillOrder = intentStrategy.fillOrder;
        var seedRecipeIdx = intentStrategy.seedRecipeIndex;
        
        // 1. 预放置链式意图触发菜谱
        if (intentStrategy.prePlaceList.length > 0) {
            for (var pp = 0; pp < intentStrategy.prePlaceList.length; pp++) {
                var prePlace = intentStrategy.prePlaceList[pp];
                var prePlaceRecipeId = _findBestFilteredRecipe(ruleIndex, chefIndex, prePlace.recipeIndex, prePlace.filterFn);
                if (prePlaceRecipeId) {
                    _simSetRecipe(ruleIndex, chefIndex, prePlace.recipeIndex, prePlaceRecipeId);
                }
            }
        }
        
        // 2. 在种子位置选最佳菜谱
        var rr = _fastGetRecipeRanking(ruleIndex, chefIndex, seedRecipeIdx, 1, true);
        if (rr.length > 0) {
            _simSetRecipe(ruleIndex, chefIndex, seedRecipeIdx, rr[0].recipeId);
        }
        
        // 3. 选厨师
        var cr = _fastGetChefRanking(ruleIndex, chefIndex, true);
        var usedIds = _getUsedChefIds(ruleIndex, chefIndex);
        for (var k = 0; k < cr.length; k++) {
            if (!cr[k].used && !usedIds[cr[k].chefId] && cr[k].skillOk !== false) {
                _simSetChef(ruleIndex, chefIndex, cr[k].chefId);
                break;
            }
        }
        
        // 4. 填充剩余菜谱
        _greedyFillRecipesOrdered(ruleIndex, chefIndex, fillOrder, seedRecipeIdx);
    }

    /**
     * 贪心填充整个贵客（意图感知版）
     */
    function _greedyFillGuestFullWithIntent(ruleIndex) {
        var rule = _rules[ruleIndex];
        var numChefs = rule.IntentList ? rule.IntentList.length : 3;
        
        for (var ci = 0; ci < numChefs; ci++) {
            var strategy = _analyzeIntents(ruleIndex, ci);
            _greedyFillPositionWithIntent(ruleIndex, ci, strategy);
        }
    }

    /**
     * 贪心填充一个位置的剩余菜谱（用评分选择，不是盲选）
     */
    function _greedyFillRecipes(ruleIndex, chefIndex) {
        for (var recipeIndex = 1; recipeIndex < 3; recipeIndex++) {
            if (_simState[ruleIndex][chefIndex].recipes[recipeIndex].data) continue;
            // 用快速排名选最佳菜谱（只取top1）
            var ranking = _fastGetRecipeRanking(ruleIndex, chefIndex, recipeIndex, 1, true);
            if (ranking.length > 0) {
                _simSetRecipe(ruleIndex, chefIndex, recipeIndex, ranking[0].recipeId);
            }
        }
    }

    /**
     * 贪心填充一个贵客的其他轮次（菜谱优先，用评分）
     */
    function _greedyFillGuest(ruleIndex, excludePos) {
        var rule = _rules[ruleIndex];
        var numChefs = rule.IntentList ? rule.IntentList.length : 3;
        var usedChefIds = _getUsedChefIds(-1, -1);
        
        for (var ci = 0; ci < numChefs; ci++) {
            if (ci === excludePos) continue;
            
            // 1. 用评分选第一道菜谱
            var recipeRanking = _fastGetRecipeRanking(ruleIndex, ci, 0, 1, true);
            if (recipeRanking.length > 0) {
                _simSetRecipe(ruleIndex, ci, 0, recipeRanking[0].recipeId);
            }
            
            // 2. 再选厨师（菜谱已设，排名准确，快速模式）
            var chefRanking = _fastGetChefRanking(ruleIndex, ci, true);
            for (var j = 0; j < chefRanking.length; j++) {
                if (!chefRanking[j].used && !usedChefIds[chefRanking[j].chefId] && chefRanking[j].skillOk !== false) {
                    _simSetChef(ruleIndex, ci, chefRanking[j].chefId);
                    usedChefIds[chefRanking[j].chefId] = true;
                    break;
                }
            }
            
            // 3. 补充其他菜谱（用评分）
            _greedyFillRecipes(ruleIndex, ci);
        }
    }

    /**
     * 贪心填充整个贵客（从零开始，菜谱优先，用评分）
     */
    function _greedyFillGuestFull(ruleIndex) {
        var rule = _rules[ruleIndex];
        var numChefs = rule.IntentList ? rule.IntentList.length : 3;
        var usedChefIds = _getUsedChefIds(-1, -1);
        
        for (var ci = 0; ci < numChefs; ci++) {
            // 1. 用评分选第一道菜谱
            var recipeRanking = _fastGetRecipeRanking(ruleIndex, ci, 0, 1, true);
            if (recipeRanking.length > 0) {
                _simSetRecipe(ruleIndex, ci, 0, recipeRanking[0].recipeId);
            }
            
            // 2. 再选厨师（快速模式）
            var chefRanking = _fastGetChefRanking(ruleIndex, ci, true);
            for (var j = 0; j < chefRanking.length; j++) {
                if (!chefRanking[j].used && !usedChefIds[chefRanking[j].chefId] && chefRanking[j].skillOk !== false) {
                    _simSetChef(ruleIndex, ci, chefRanking[j].chefId);
                    usedChefIds[chefRanking[j].chefId] = true;
                    break;
                }
            }
            
            // 3. 补充其他菜谱（用评分）
            _greedyFillRecipes(ruleIndex, ci);
        }
    }

    // ==================== 爬山搜索 ====================

    /**
     * 厨师交换搜索：尝试交换两个位置的厨师
     */
    function _climbChefSwap() {
        var improved = false;
        var positions = []; // [{ri, ci}]
        
        for (var ri = 0; ri < _rules.length; ri++) {
            if (!_shouldProcessRule(ri)) continue;
            var numChefs = _rules[ri].IntentList ? _rules[ri].IntentList.length : 3;
            for (var ci = 0; ci < numChefs; ci++) {
                if (_simState[ri][ci].chefId) {
                    positions.push({ri: ri, ci: ci});
                }
            }
        }
        
        var currentScore = _bestScore;
        
        for (var i = 0; i < positions.length - 1; i++) {
            for (var j = i + 1; j < positions.length; j++) {
                
                var p1 = positions[i], p2 = positions[j];
                var id1 = _simState[p1.ri][p1.ci].chefId;
                var id2 = _simState[p2.ri][p2.ci].chefId;
                
                if (id1 === id2) continue;
                
                // 交换
                _simSetChef(p1.ri, p1.ci, id2);
                _simSetChef(p2.ri, p2.ci, id1);
                
                // 交换后需要重新计算菜谱份数
                for (var reci = 0; reci < 3; reci++) {
                    var r1 = _simState[p1.ri][p1.ci].recipes[reci];
                    if (r1.data) _simSetRecipe(p1.ri, p1.ci, reci, r1.data.recipeId);
                    var r2 = _simState[p2.ri][p2.ci].recipes[reci];
                    if (r2.data) _simSetRecipe(p2.ri, p2.ci, reci, r2.data.recipeId);
                }
                
                var newScore = _fastCalcScore();
                
                if (newScore > _bestScore) {
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                } else {
                    // 换回来
                    _simSetChef(p1.ri, p1.ci, id1);
                    _simSetChef(p2.ri, p2.ci, id2);
                    for (var reci = 0; reci < 3; reci++) {
                        var r1 = _simState[p1.ri][p1.ci].recipes[reci];
                        if (r1.data) _simSetRecipe(p1.ri, p1.ci, reci, r1.data.recipeId);
                        var r2 = _simState[p2.ri][p2.ci].recipes[reci];
                        if (r2.data) _simSetRecipe(p2.ri, p2.ci, reci, r2.data.recipeId);
                    }
                }
            }
        }
        
        return improved;
    }

    function _climbChefs() {
        var improved = false;
        
        for (var ruleIndex = 0; ruleIndex < _rules.length; ruleIndex++) {
            if (!_shouldProcessRule(ruleIndex)) continue;
            
            var rule = _rules[ruleIndex];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            
            for (var chefIndex = 0; chefIndex < numChefs; chefIndex++) {
                
                var currentChefId = _simState[ruleIndex][chefIndex].chefId;
                var usedChefIds = _getUsedChefIds(ruleIndex, chefIndex);
                
                // 排名函数内部已经计算了每个厨师的分数（fastMode加速）
                var chefRanking = _fastGetChefRanking(ruleIndex, chefIndex, true);
                
                // 遍历top候选厨师，用全局分数验证（不再只看第一个）
                var triedCount = 0;
                var maxTry = 3; // 最多尝试3个厨师
                for (var i = 0; i < chefRanking.length && triedCount < maxTry; i++) {
                    var cr = chefRanking[i];
                    if (cr.used || usedChefIds[cr.chefId]) continue;
                    if (cr.chefId === currentChefId) continue;
                    if (cr.skillOk === false) continue;
                    triedCount++;
                    
                    _simSetChef(ruleIndex, chefIndex, cr.chefId);
                    var newTotal = _fastCalcScore();
                    if (newTotal > _bestScore) {
                        _bestScore = newTotal;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        currentChefId = cr.chefId; // 更新当前厨师
                        break; // 找到改进就停
                    } else {
                        // 回退
                        _simSetChef(ruleIndex, chefIndex, currentChefId);
                    }
                }
            }
        }
        
        return improved;
    }

    function _climbRecipes() {
        var improved = false;
        
        for (var ruleIndex = 0; ruleIndex < _rules.length; ruleIndex++) {
            if (!_shouldProcessRule(ruleIndex)) continue;
            
            var rule = _rules[ruleIndex];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            
            for (var chefIndex = 0; chefIndex < numChefs; chefIndex++) {
                for (var recipeIndex = 0; recipeIndex < 3; recipeIndex++) {
                    
                    var currentRecipeId = _simState[ruleIndex][chefIndex].recipes[recipeIndex].data 
                        ? _simState[ruleIndex][chefIndex].recipes[recipeIndex].data.recipeId : null;
                    
                    // 用全局分数作为基准（而非单贵客分数，避免跨贵客效果导致误判）
                    var currentTotalScore = _bestScore;
                    
                    // 扩大搜索宽度：取top7候选
                    var recipeRanking = _fastGetRecipeRanking(ruleIndex, chefIndex, recipeIndex, 7, true);
                    
                    // 遍历所有候选，用全局分数验证（不再只看第一个）
                    var savedRecipe = _simState[ruleIndex][chefIndex].recipes[recipeIndex];
                    for (var c = 0; c < recipeRanking.length; c++) {
                        if (recipeRanking[c].recipeId === currentRecipeId) continue;
                        
                        _simSetRecipe(ruleIndex, chefIndex, recipeIndex, recipeRanking[c].recipeId);
                        var newTotal = _fastCalcScore();
                        if (newTotal > _bestScore) {
                            _bestScore = newTotal;
                            _bestSimState = _cloneSimState(_simState);
                            improved = true;
                            currentRecipeId = recipeRanking[c].recipeId; // 更新当前菜谱
                            break; // 找到改进就停
                        } else {
                            // 回退
                            _simState[ruleIndex][chefIndex].recipes[recipeIndex] = savedRecipe;
                        }
                    }
                }
            }
        }
        
        return improved;
    }

    // ==================== 菜谱交换搜索 ====================

    /**
     * 菜谱交换搜索：尝试交换两个位置的菜谱（同一贵客内或跨贵客）
     * 核心新增：两个位置的某道菜互换，可能发现贪心找不到的组合
     */
    function _climbRecipeSwap() {
        var improved = false;
        var positions = []; // [{ri, ci, reci}] 所有有菜谱的位置
        
        for (var ri = 0; ri < _rules.length; ri++) {
            if (!_shouldProcessRule(ri)) continue;
            var numChefs = _rules[ri].IntentList ? _rules[ri].IntentList.length : 3;
            for (var ci = 0; ci < numChefs; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    if (_simState[ri][ci].recipes[reci].data) {
                        positions.push({ri: ri, ci: ci, reci: reci});
                    }
                }
            }
        }
        
        for (var i = 0; i < positions.length - 1; i++) {
            for (var j = i + 1; j < positions.length; j++) {
                
                var p1 = positions[i], p2 = positions[j];
                var r1 = _simState[p1.ri][p1.ci].recipes[p1.reci];
                var r2 = _simState[p2.ri][p2.ci].recipes[p2.reci];
                
                if (!r1.data || !r2.data) continue;
                if (r1.data.recipeId === r2.data.recipeId) continue;
                
                // 检查交换后技法是否满足
                var chef1 = _simState[p1.ri][p1.ci].chefObj;
                var chef2 = _simState[p2.ri][p2.ci].chefObj;
                if (!chef1 || !chef2) continue;
                
                // 简单技法检查：r2的菜给chef1做，r1的菜给chef2做
                var rd2 = r2.data, rd1 = r1.data;
                if (rd2.stirfry > 0 && (!chef1.stirfryVal || chef1.stirfryVal < rd2.stirfry)) continue;
                if (rd2.boil > 0 && (!chef1.boilVal || chef1.boilVal < rd2.boil)) continue;
                if (rd2.knife > 0 && (!chef1.knifeVal || chef1.knifeVal < rd2.knife)) continue;
                if (rd2.fry > 0 && (!chef1.fryVal || chef1.fryVal < rd2.fry)) continue;
                if (rd2.bake > 0 && (!chef1.bakeVal || chef1.bakeVal < rd2.bake)) continue;
                if (rd2.steam > 0 && (!chef1.steamVal || chef1.steamVal < rd2.steam)) continue;
                
                if (rd1.stirfry > 0 && (!chef2.stirfryVal || chef2.stirfryVal < rd1.stirfry)) continue;
                if (rd1.boil > 0 && (!chef2.boilVal || chef2.boilVal < rd1.boil)) continue;
                if (rd1.knife > 0 && (!chef2.knifeVal || chef2.knifeVal < rd1.knife)) continue;
                if (rd1.fry > 0 && (!chef2.fryVal || chef2.fryVal < rd1.fry)) continue;
                if (rd1.bake > 0 && (!chef2.bakeVal || chef2.bakeVal < rd1.bake)) continue;
                if (rd1.steam > 0 && (!chef2.steamVal || chef2.steamVal < rd1.steam)) continue;
                
                // 执行交换
                _simSetRecipe(p1.ri, p1.ci, p1.reci, rd2.recipeId);
                _simSetRecipe(p2.ri, p2.ci, p2.reci, rd1.recipeId);
                
                var newScore = _fastCalcScore();
                
                if (newScore > _bestScore) {
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                } else {
                    // 换回来
                    _simSetRecipe(p1.ri, p1.ci, p1.reci, rd1.recipeId);
                    _simSetRecipe(p2.ri, p2.ci, p2.reci, rd2.recipeId);
                }
            }
        }
        
        return improved;
    }

    // ==================== 厨师+菜谱联合替换 ====================

    /**
     * 联合替换：对每个位置，尝试换一个新厨师并重新选菜谱
     * 这能发现"当前厨师做当前菜不如换个厨师做别的菜"的情况
     * 单独换厨师或单独换菜谱都找不到这种组合
     */
    function _climbJointChefRecipe() {
        var improved = false;
        
        for (var ruleIndex = 0; ruleIndex < _rules.length; ruleIndex++) {
            if (!_shouldProcessRule(ruleIndex)) continue;
            
            var rule = _rules[ruleIndex];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            
            for (var chefIndex = 0; chefIndex < numChefs; chefIndex++) {
                var currentChefId = _simState[ruleIndex][chefIndex].chefId;
                var usedChefIds = _getUsedChefIds(ruleIndex, chefIndex);
                
                // 保存当前位置完整状态
                var savedSlot = {
                    chefId: _simState[ruleIndex][chefIndex].chefId,
                    chefObj: _simState[ruleIndex][chefIndex].chefObj,
                    equipObj: _simState[ruleIndex][chefIndex].equipObj,
                    recipes: [
                        _simState[ruleIndex][chefIndex].recipes[0],
                        _simState[ruleIndex][chefIndex].recipes[1],
                        _simState[ruleIndex][chefIndex].recipes[2]
                    ]
                };
                
                var chefRanking = _fastGetChefRanking(ruleIndex, chefIndex, true);
                var triedCount = 0;
                
                for (var ci = 0; ci < chefRanking.length && triedCount < 3; ci++) {
                    var cr = chefRanking[ci];
                    if (cr.used || usedChefIds[cr.chefId]) continue;
                    if (cr.chefId === currentChefId) continue;
                    if (cr.skillOk === false) continue;
                    triedCount++;
                    
                    // 换厨师
                    _simSetChef(ruleIndex, chefIndex, cr.chefId);
                    
                    // 重新选所有3道菜谱
                    for (var reci = 0; reci < 3; reci++) {
                        var rk = _fastGetRecipeRanking(ruleIndex, chefIndex, reci, 1, true);
                        if (rk.length > 0) {
                            _simSetRecipe(ruleIndex, chefIndex, reci, rk[0].recipeId);
                        }
                    }
                    
                    var newTotal = _fastCalcScore();
                    if (newTotal > _bestScore) {
                        _bestScore = newTotal;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        break; // 找到改进就停
                    } else {
                        // 回退整个位置
                        _simState[ruleIndex][chefIndex].chefId = savedSlot.chefId;
                        _simState[ruleIndex][chefIndex].chefObj = savedSlot.chefObj;
                        _simState[ruleIndex][chefIndex].equipObj = savedSlot.equipObj;
                        _simState[ruleIndex][chefIndex].recipes = savedSlot.recipes;
                    }
                }
            }
        }
        
        return improved;
    }

    // ==================== 主流程 ====================

    // 匀速进度系统 — 定时器驱动，避免阶段性跳跃
    var _progressTimer = null;
    var _progressTarget = 0;      // 各阶段设置的目标进度 (0-99)
    var _progressDisplay = 0;     // 当前显示的进度
    var _progressDisplayScore = 0; // 进度条显示的最高分（只升不降）
    var _progressCallback = null; // 外部回调
    var _progressStartTime = 0;   // 优化开始时间
    var _progressEstTotal = 80000; // 预估总时间(ms)，动态调整

    function _startProgressTimer(onProgress) {
        _progressCallback = onProgress;
        _progressDisplay = 0;
        _progressDisplayScore = 0;
        _progressTarget = 0;
        _progressStartTime = Date.now();
        _progressEstTotal = 80000; // 初始预估80秒
        
        if (_progressTimer) clearInterval(_progressTimer);
        _progressTimer = setInterval(function() {
            if (!_isRunning) { _stopProgressTimer(); return; }
            
            var elapsed = Date.now() - _progressStartTime;
            // 基于时间的最低进度：用对数曲线，前期快后期慢，最高到95%
            // timePct = 95 * (1 - e^(-elapsed/estTotal*3))
            var timeRatio = elapsed / _progressEstTotal;
            var timePct = Math.floor(95 * (1 - Math.exp(-timeRatio * 3)));
            
            // 取 时间进度 和 阶段目标进度 的较大值
            var targetNow = Math.max(timePct, _progressTarget);
            
            // 平滑靠近目标：每次最多+2，保证匀速感
            if (_progressDisplay < targetNow) {
                _progressDisplay = Math.min(_progressDisplay + 2, targetNow);
            }
            
            // 限制最大99%（100%由完成回调设置）
            _progressDisplay = Math.min(_progressDisplay, 99);
            
            // 分数只升不降：始终显示历史最高分
            if (_bestScore > _progressDisplayScore) {
                _progressDisplayScore = _bestScore;
            }
            
            if (typeof _progressCallback === 'function') {
                _progressCallback(_progressDisplay, _progressDisplayScore);
            }
        }, 300);
    }

    function _stopProgressTimer() {
        if (_progressTimer) {
            clearInterval(_progressTimer);
            _progressTimer = null;
        }
    }

    // 各阶段调用此函数设置目标进度（不直接调用onProgress）
    function _setProgressTarget(pct) {
        _progressTarget = Math.max(_progressTarget, pct);
    }

    function optimize(targetScore, onProgress, onComplete) {
        _targetScore = (targetScore && targetScore > 0) ? targetScore : null;
        _quantitySearchMode = _targetScore ? 'single' : 'full';
        
        if (_isRunning) {
            if (typeof onComplete === 'function') {
                onComplete({ success: false, score: 0, message: '正在运行' });
            }
            return;
        }
        
        if (_rules.length === 0) {
            if (typeof onComplete === 'function') {
                onComplete({ success: false, score: 0, message: '未初始化' });
            }
            return;
        }
        
        _isRunning = true;
        _bestSimState = null;
        _bestScore = 0;
        
        if (typeof onProgress === 'function') {
            onProgress(0, 0);
        }
        
        // 启动匀速进度定时器
        _startProgressTimer(onProgress);
        
        setTimeout(function() {
            _runOptimization(onProgress, onComplete);
        }, 10);
    }

    function _runOptimization(onProgress, onComplete) {
        _timeStats = { startTime: Date.now(), phase2Skipped: 0, phase2Executed: 0, phase2Calls: 0 };
        
        // 初始化改为异步，支持进度回调和目标分数提前终止
        setTimeout(function() {
            
            _generateInitialSolutionAsync(onProgress, function() {
                // 初始化完成回调
                
                var initialScore = _fastCalcScore();
                _bestScore = initialScore;
                _bestSimState = _cloneSimState(_simState);
            
            _timeStats.initTime = Date.now() - _timeStats.startTime;
            _setProgressTarget(10);
            
            // 初始化后检查：分数达标且饱食度达标时直接结束
            if (_isTargetReachedWithSatiety()) {
                _finishOptimization(onComplete, false);
                return;
            }
            
            // 如果分数达标但饱食度不达标，执行一轮爬山优化
            if (_isTargetReached() && !_isAllSatietyOk()) {
                if (_isSatietyDiffAcceptable()) {
                    // 饱食度差值<=2，执行爬山优化
                    _simState = _cloneSimState(_bestSimState);
                    _runClimbingPhase(0, function() {
                        var climbScore = _fastCalcScore();
                        if (climbScore > _bestScore) {
                            _bestScore = climbScore;
                            _bestSimState = _cloneSimState(_simState);
                        }
                        // 爬山后再次检查，如果达标则结束
                        if (_isTargetReachedWithSatiety()) {
                            _finishOptimization(onComplete, false);
                            return;
                        }
                        // 饱食度仍不达标，继续后续搜索
                        _continueMultiSeedSearch();
                    });
                    return;
                } else {
                    // 饱食度差值>2，跳过爬山，直接继续后续搜索
                    _continueMultiSeedSearch();
                    return;
                }
            }
            
            // 分数未达标，继续多起点搜索
            _continueMultiSeedSearch();
            
            function _continueMultiSeedSearch() {
        
        // 多起点搜索 — 精确去重 + 提前终止
        var uniqueSeeds = [];
        var seenScores = {};
        for (var si = 0; si < _topCandidates.length; si++) {
            _simState = _cloneSimState(_topCandidates[si]);
            var sc = _fastCalcScore();
            if (!seenScores[sc]) {
                seenScores[sc] = true;
                uniqueSeeds.push({state: _topCandidates[si], score: sc});
            }
        }
        var seedIdx = 0;
        var totalSeeds = uniqueSeeds.length;
        // 记录已搜索到的最终分数，用于检测收敛
        var seenFinalScores = {};
        
        function _runSeedSearch() {
            if (seedIdx >= totalSeeds) {
                _finishOptimization(onComplete);
                return;
            }
            
            // 种子搜索前检查：分数和饱食度都达标时结束
            if (_isTargetReachedWithSatiety()) {
                _finishOptimization(onComplete, false);
                return;
            }
            
            var currentSeed = seedIdx;
            seedIdx++;
            var seedInfo = uniqueSeeds[currentSeed];
            var seedScore = seedInfo.score;
            
            // 跳过分数过低的种子（<最佳90%）
            if (seedScore < _bestScore * 0.90 && currentSeed > 0) {
                setTimeout(_runSeedSearch, 2);
                return;
            }
            
            // 保存全局最佳
            var globalBestScore = _bestScore;
            var globalBestState = _cloneSimState(_bestSimState);
            
            // 从种子状态开始独立搜索
            _simState = _cloneSimState(seedInfo.state);
            _bestScore = seedScore;
            _bestSimState = _cloneSimState(_simState);
            
            // 爬山
            _runClimbingPhase(0, function() {
                // 爬山后再检查 — 跳过无望种子，节省深度搜索时间
                // 注意：跨贵客重分配可带来5%+的提升，阈值不能太激进
                var climbedScore = _bestScore;
                var climbImproved = (climbedScore > seedScore);
                var ratio = globalBestScore > 0 ? climbedScore / globalBestScore : 1;
                // 条件1：爬山无改进且<90% → 跳过（保守，避免误杀有潜力的种子）
                // 条件2：即使有改进，<88% → 也跳过（差距太大，跨贵客难以弥补）
                if (currentSeed > 0 && ((!climbImproved && ratio < 0.90) || ratio < 0.88)) {
                    _bestScore = globalBestScore;
                    _bestSimState = globalBestState;
                    _setProgressTarget(Math.floor(10 + 80 * seedIdx / totalSeeds));
                    setTimeout(_runSeedSearch, 2);
                    return;
                }
                
                var activeRules = [];
                for (var ri = 0; ri < _rules.length; ri++) {
                    if (_shouldProcessRule(ri)) activeRules.push(ri);
                }
                
                // 边界种子轻量搜索 — 90%-95%之间的种子只做1轮跨贵客，跳过重建
                var isLightSeed = (currentSeed > 0 && ratio < 0.95);
                if (isLightSeed) {
                }
                
                // 跳过穷举搜索（历史数据显示从未产生改进）
                // _exhaustiveSlotSearch(activeRules);
                
                // 多轮跨贵客（边界种子只做1轮，正常种子最多2轮）
                var crossRound = 0;
                var maxCross = isLightSeed ? 1 : 2;
                
                function _seedCrossLoop() {
                    if (crossRound >= maxCross) {
                        _seedAfterCross();
                        return;
                    }
                    crossRound++;
                    // 拆分跨贵客循环，避免阻塞浏览器
                    setTimeout(function() {
                        var scoreBefore = _bestScore;
                        var crossImproved = _crossGuestReassign(activeRules);
                        if (crossImproved) {
                            setTimeout(function() {
                                _simState = _cloneSimState(_bestSimState);
                                _climbRecipeSwap();
                                var ss = _fastCalcScore();
                                if (ss > _bestScore) { _bestScore = ss; _bestSimState = _cloneSimState(_simState); }
                                setTimeout(_seedCrossLoop, 2);
                            }, 0);
                        } else {
                            _seedAfterCross();
                        }
                    }, 0);
                }
                
                function _seedAfterCross() {
                    // 边界种子跳过整贵客重建和最终爬山
                    if (isLightSeed) {
                        // 拆分setTimeout避免阻塞浏览器
                        setTimeout(function() {
                            _simState = _cloneSimState(_bestSimState);
                            _climbRecipeSwap();
                            var ss = _fastCalcScore();
                            if (ss > _bestScore) { _bestScore = ss; _bestSimState = _cloneSimState(_simState); }
                            _finishSeed();
                        }, 0);
                        return;
                    }
                    
                    // 整贵客重建 — 减少厨师候选数（10→5），且仅在跨贵客有改进时才执行
                    var crossDidImprove = (_bestScore > seedScore);
                    
                    // 整贵客重建放到setTimeout中
                    setTimeout(function() {
                        if (crossDidImprove) {
                            _fullGuestRebuild(activeRules);
                        } else {
                        }
                        
                        // 菜谱交换也放到独立setTimeout
                        setTimeout(function() {
                            var scoreBeforeFinish = _bestScore;
                            _simState = _cloneSimState(_bestSimState);
                            _climbRecipeSwap();
                            var ss = _fastCalcScore();
                            if (ss > _bestScore) { _bestScore = ss; _bestSimState = _cloneSimState(_simState); }
                            
                            var needFinalClimb = (_bestScore > scoreBeforeFinish) || crossDidImprove;
                            if (needFinalClimb) {
                                _runClimbingPhase(0, function() {
                                    _finishSeed();
                                }, onProgress);
                            } else {
                                _finishSeed();
                            }
                        }, 0);
                    }, 0);
                }
                
                function _finishSeed() {
                    var seedFinalScore = _bestScore;
                    // 收敛到已知结果时跳过剩余种子（提前终止）
                    if (seenFinalScores[seedFinalScore]) {
                        // 与全局最佳比较后直接结束
                        if (seedFinalScore > globalBestScore) {
                            globalBestScore = seedFinalScore;
                            globalBestState = _cloneSimState(_bestSimState);
                        }
                        _bestScore = globalBestScore;
                        _bestSimState = globalBestState;
                        _finishOptimization(onComplete, false);
                        return;
                    }
                    seenFinalScores[seedFinalScore] = true;
                    
                    // 与全局最佳比较
                    if (seedFinalScore > globalBestScore) {
                        globalBestScore = seedFinalScore;
                        globalBestState = _cloneSimState(_bestSimState);
                    }
                    
                    // 恢复全局最佳
                    _bestScore = globalBestScore;
                    _bestSimState = globalBestState;
                    
                    // 种子完成后检查：分数和饱食度都达标时结束
                    if (_isTargetReachedWithSatiety()) {
                        _finishOptimization(onComplete, false);
                        return;
                    }
                    
                    _setProgressTarget(Math.floor(10 + 80 * seedIdx / totalSeeds));
                    
                    setTimeout(_runSeedSearch, 2);
                }
                
                setTimeout(_seedCrossLoop, 2);
            }, onProgress);
        }
        
        _runSeedSearch();
            } // end _continueMultiSeedSearch
        }); // end _generateInitialSolutionAsync callback
        }, 10);
    }

    // 随机扰动保留为补充手段（主搜索改为系统性深度搜索）
    function _perturbAndRebuild() {
        var activeRules = [];
        for (var ri = 0; ri < _rules.length; ri++) {
            if (_shouldProcessRule(ri)) activeRules.push(ri);
        }
        if (Math.random() < 0.5) {
            return _microPerturb(activeRules);
        }
        return _positionPerturb(activeRules);
    }
    
    /**
     * 微扰动：只替换1-2道菜谱（不动厨师，不清空位置）
     * 更精细的搜索，保留大部分已有结构
     */
    function _microPerturb(activeRules) {
        var allSlots = [];
        for (var ri = 0; ri < activeRules.length; ri++) {
            var ruleIndex = activeRules[ri];
            var numChefs = _rules[ruleIndex].IntentList ? _rules[ruleIndex].IntentList.length : 3;
            for (var ci = 0; ci < numChefs; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    if (_simState[ruleIndex][ci].recipes[reci].data) {
                        allSlots.push({ri: ruleIndex, ci: ci, reci: reci});
                    }
                }
            }
        }
        if (allSlots.length === 0) return _fastCalcScore();
        var numReplace = Math.random() < 0.5 ? 1 : 2;
        for (var i = allSlots.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = allSlots[i]; allSlots[i] = allSlots[j]; allSlots[j] = tmp;
        }
        for (var k = 0; k < Math.min(numReplace, allSlots.length); k++) {
            var slot = allSlots[k];
            var skipCount = Math.floor(Math.random() * 5) + 1;
            var rr = _fastGetRecipeRanking(slot.ri, slot.ci, slot.reci, skipCount + 1, true);
            var idx = Math.min(skipCount, rr.length - 1);
            if (idx >= 0 && rr.length > idx) {
                _simSetRecipe(slot.ri, slot.ci, slot.reci, rr[idx].recipeId);
            }
        }
        _quickRefineFast(activeRules, false);
        return _fastCalcScore();
    }
    
    /**
     * 位置级扰动（原有逻辑，略微优化）
     */
    function _positionPerturb(activeRules) {
        var allPositions = [];
        for (var ri = 0; ri < activeRules.length; ri++) {
            var ruleIndex = activeRules[ri];
            var numChefs = _rules[ruleIndex].IntentList ? _rules[ruleIndex].IntentList.length : 3;
            for (var ci = 0; ci < numChefs; ci++) {
                allPositions.push({ri: ruleIndex, ci: ci});
            }
        }
        for (var i = allPositions.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = allPositions[i]; allPositions[i] = allPositions[j]; allPositions[j] = tmp;
        }
        var numPerturb = Math.min(CONFIG.perturbPositions, allPositions.length);
        for (var i = 0; i < numPerturb; i++) {
            var pos = allPositions[i];
            _simState[pos.ri][pos.ci].chefId = null;
            _simState[pos.ri][pos.ci].chefObj = null;
            _simState[pos.ri][pos.ci].equipObj = {};
            for (var reci = 0; reci < 3; reci++) {
                _simState[pos.ri][pos.ci].recipes[reci] = {data: null, quantity: 0, max: 0};
            }
        }
        for (var i = 0; i < numPerturb; i++) {
            var pos = allPositions[i];
            var strategy = _analyzeIntents(pos.ri, pos.ci);
            _greedyFillPositionWithIntent(pos.ri, pos.ci, strategy);
        }
        _quickRefineFast(activeRules, false);
        return _fastCalcScore();
    }

    // ==================== 系统性深度搜索 ====================
    
    /**
     * 逐位置穷举搜索：对每个菜谱位置，系统性尝试排名第2~K的菜谱
     * 每次替换后做完整精调，看是否能突破局部最优
     */
    function _exhaustiveSlotSearch(activeRules) {
        var bestScore = _bestScore;
        var improved = false;
        
        for (var ari = 0; ari < activeRules.length; ari++) {
            var ruleIndex = activeRules[ari];
            var numChefs = _rules[ruleIndex].IntentList ? _rules[ruleIndex].IntentList.length : 3;
            
            for (var ci = 0; ci < numChefs; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    
                    var curRecId = _simState[ruleIndex][ci].recipes[reci].data 
                        ? _simState[ruleIndex][ci].recipes[reci].data.recipeId : null;
                    
                    var rk = _fastGetRecipeRanking(ruleIndex, ci, reci, CONFIG.recipeTopN, true);
                    
                    for (var ki = 0; ki < rk.length; ki++) {
                        if (rk[ki].recipeId === curRecId) continue;
                        
                        _simState = _cloneSimState(_bestSimState);
                        _simSetRecipe(ruleIndex, ci, reci, rk[ki].recipeId);
                        _quickRefineFast(activeRules, false);
                        
                        var newScore = _fastCalcScore();
                        if (newScore > bestScore) {
                            bestScore = newScore;
                            _bestScore = newScore;
                            _bestSimState = _cloneSimState(_simState);
                            improved = true;
                            var recipeName = _recipeMap[rk[ki].recipeId] ? _recipeMap[rk[ki].recipeId].name : '?';
                        }
                    }
                }
            }
        }
        
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }
    
    /**
     * 跨贵客重分配：固定一个贵客，对另一个贵客做完整重搜索
     * 核心思路：当前解可能把好厨师分配给了错误的贵客
     */
    function _crossGuestReassign(activeRules) {
        if (activeRules.length < 2) return false;
        
        // 自适应精调深度 — 菜谱少时精调更深，菜谱多时轻量+后补
        var totalMenus = 0;
        for (var mi = 0; mi < _menusByRule.length; mi++) totalMenus += _menusByRule[mi].length;
        // 方案A精调模式：少菜谱完整，多菜谱轻量
        var planARefineMode = totalMenus > 800 ? true : false;
        // 方案B精调模式：少菜谱2轮，多菜谱轻量
        var crossRefineMode = totalMenus > 800 ? true : 2;
        
        var improved = false;
        
        for (var targetIdx = 0; targetIdx < activeRules.length; targetIdx++) {
            var targetRule = activeRules[targetIdx];
            var rule = _rules[targetRule];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            
            // 方案A: 清空目标贵客，用意图感知重新填充
            _simState = _cloneSimState(_bestSimState);
            for (var ci = 0; ci < numChefs; ci++) {
                _simState[targetRule][ci] = {chefId: null, chefObj: null, equipObj: {}, recipes: [{data:null,quantity:0,max:0},{data:null,quantity:0,max:0},{data:null,quantity:0,max:0}]};
            }
            _greedyFillGuestFullWithIntent(targetRule);
            _quickRefineFast(activeRules, planARefineMode);  // 方案A自适应精调
            var newScore = _fastCalcScore();
            if (newScore > _bestScore) {
                _bestScore = newScore;
                _bestSimState = _cloneSimState(_simState);
                improved = true;
            }
            
            // 方案B: 对目标贵客的每个位置，尝试不同种子菜谱
            for (var seedPos = 0; seedPos < numChefs; seedPos++) {
                var strategy = _analyzeIntents(targetRule, seedPos);
                var seedRecipeIdx = strategy.seedRecipeIndex;
                
                // 获取种子菜谱排名
                _simState = _cloneSimState(_bestSimState);
                // 清空目标位置
                _simState[targetRule][seedPos] = {chefId: null, chefObj: null, equipObj: {}, recipes: [{data:null,quantity:0,max:0},{data:null,quantity:0,max:0},{data:null,quantity:0,max:0}]};
                
                if (strategy.prePlaceList.length > 0) {
                    for (var pp = 0; pp < strategy.prePlaceList.length; pp++) {
                        var prePlace = strategy.prePlaceList[pp];
                        var prePlaceRecipeId = _findBestFilteredRecipe(targetRule, seedPos, prePlace.recipeIndex, prePlace.filterFn);
                        if (prePlaceRecipeId) _simSetRecipe(targetRule, seedPos, prePlace.recipeIndex, prePlaceRecipeId);
                    }
                }
                
                var topRecipes = _fastGetRecipeRanking(targetRule, seedPos, seedRecipeIdx, 5, true);
                
                for (var rsi = 0; rsi < topRecipes.length; rsi++) {
                    
                    _simState = _cloneSimState(_bestSimState);
                    _simState[targetRule][seedPos] = {chefId: null, chefObj: null, equipObj: {}, recipes: [{data:null,quantity:0,max:0},{data:null,quantity:0,max:0},{data:null,quantity:0,max:0}]};
                    
                    if (strategy.prePlaceList.length > 0) {
                        for (var pp = 0; pp < strategy.prePlaceList.length; pp++) {
                            var prePlace = strategy.prePlaceList[pp];
                            var prePlaceRecipeId = _findBestFilteredRecipe(targetRule, seedPos, prePlace.recipeIndex, prePlace.filterFn);
                            if (prePlaceRecipeId) _simSetRecipe(targetRule, seedPos, prePlace.recipeIndex, prePlaceRecipeId);
                        }
                    }
                    
                    _simSetRecipe(targetRule, seedPos, seedRecipeIdx, topRecipes[rsi].recipeId);
                    var cr = _fastGetChefRanking(targetRule, seedPos, true);
                    var usedIds = _getUsedChefIds(targetRule, seedPos);
                    for (var j = 0; j < cr.length; j++) {
                        if (!cr[j].used && !usedIds[cr[j].chefId] && cr[j].skillOk !== false) {
                            _simSetChef(targetRule, seedPos, cr[j].chefId);
                            break;
                        }
                    }
                    _greedyFillRecipesOrdered(targetRule, seedPos, strategy.fillOrder, seedRecipeIdx);
                    _quickRefineFast(activeRules, crossRefineMode);  // 自适应精调深度
                    
                    var newScore2 = _fastCalcScore();
                    if (newScore2 > _bestScore) {
                        _bestScore = newScore2;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        var recipeName = _recipeMap[topRecipes[rsi].recipeId] ? _recipeMap[topRecipes[rsi].recipeId].name : '?';
                    }
                }
            }
        }
        
        _simState = _cloneSimState(_bestSimState);
        // 如果跨贵客有改进，做一次完整精调弥补轻量模式的精度损失
        if (improved) {
            _quickRefineFast(activeRules, false);
            var refinedScore = _fastCalcScore();
            if (refinedScore > _bestScore) {
                _bestScore = refinedScore;
                _bestSimState = _cloneSimState(_simState);
            }
            _simState = _cloneSimState(_bestSimState);
        }
        return improved;
    }
    
    /**
     * 整贵客重建：完全清空一个贵客，用不同的首厨师重建
     */
    function _fullGuestRebuild(activeRules) {
        var improved = false;
        
        for (var targetIdx = 0; targetIdx < activeRules.length; targetIdx++) {
            var targetRule = activeRules[targetIdx];
            var rule = _rules[targetRule];
            var numChefs = rule.IntentList ? rule.IntentList.length : 3;
            var gName = rule.Title || ('贵客' + (targetRule + 1));
            
            // 收集当前解中目标贵客使用的厨师
            var currentChefSet = {};
            for (var ci = 0; ci < numChefs; ci++) {
                if (_bestSimState[targetRule][ci].chefId) currentChefSet[_bestSimState[targetRule][ci].chefId] = true;
            }
            
            // 收集其他贵客使用的厨师
            var otherUsedChefs = {};
            for (var ri = 0; ri < _bestSimState.length; ri++) {
                if (ri === targetRule) continue;
                for (var ci = 0; ci < _bestSimState[ri].length; ci++) {
                    if (_bestSimState[ri][ci].chefId) otherUsedChefs[_bestSimState[ri][ci].chefId] = true;
                }
            }
            
            // 可用厨师（排除其他贵客已用的）
            var availableChefs = [];
            for (var i = 0; i < rule.chefs.length; i++) {
                var chef = rule.chefs[i];
                if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
                if (otherUsedChefs[chef.chefId]) continue;
                availableChefs.push(chef);
            }
            availableChefs.sort(function(a, b) { return b.rarity - a.rarity; });
            
            var triedCombos = {};
            
            // 对每个位置，尝试不同的首厨师
            for (var startPos = 0; startPos < numChefs; startPos++) {
                for (var firstChefIdx = 0; firstChefIdx < Math.min(5, availableChefs.length); firstChefIdx++) {
                    var firstChef = availableChefs[firstChefIdx];
                    if (currentChefSet[firstChef.chefId] && startPos === 0) continue;
                    
                    _simState = _cloneSimState(_bestSimState);
                    for (var ci = 0; ci < numChefs; ci++) {
                        _simState[targetRule][ci] = {chefId: null, chefObj: null, equipObj: {}, recipes: [{data:null,quantity:0,max:0},{data:null,quantity:0,max:0},{data:null,quantity:0,max:0}]};
                    }
                    
                    _simSetChef(targetRule, startPos, firstChef.chefId);
                    var strategy0 = _analyzeIntents(targetRule, startPos);
                    if (strategy0.prePlaceList.length > 0) {
                        for (var pp = 0; pp < strategy0.prePlaceList.length; pp++) {
                            var prePlace = strategy0.prePlaceList[pp];
                            var prePlaceRecipeId = _findBestFilteredRecipe(targetRule, startPos, prePlace.recipeIndex, prePlace.filterFn);
                            if (prePlaceRecipeId) _simSetRecipe(targetRule, startPos, prePlace.recipeIndex, prePlaceRecipeId);
                        }
                    }
                    var rk0 = _fastGetRecipeRanking(targetRule, startPos, strategy0.seedRecipeIndex, 1, true);
                    if (rk0.length > 0) _simSetRecipe(targetRule, startPos, strategy0.seedRecipeIndex, rk0[0].recipeId);
                    _greedyFillRecipesOrdered(targetRule, startPos, strategy0.fillOrder, strategy0.seedRecipeIndex);
                    
                    for (var ci = 0; ci < numChefs; ci++) {
                        if (ci === startPos) continue;
                        var strategyN = _analyzeIntents(targetRule, ci);
                        _greedyFillPositionWithIntent(targetRule, ci, strategyN);
                    }
                    
                    _quickRefineFast(activeRules, true);  // 轻量精调
                    
                    var comboKey = [];
                    for (var ci = 0; ci < numChefs; ci++) comboKey.push(_simState[targetRule][ci].chefId || 0);
                    comboKey.sort();
                    var comboStr = comboKey.join('_');
                    if (triedCombos[comboStr]) continue;
                    triedCombos[comboStr] = true;
                    
                    var newScore = _fastCalcScore();
                    if (newScore > _bestScore) {
                        _bestScore = newScore;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        var chefNames = [];
                        for (var ci = 0; ci < numChefs; ci++) chefNames.push(_getChefNameById(_simState[targetRule][ci].chefId));
                    }
                }
            }
        }
        
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }

    
    /**
     * 保留的随机扰动（作为补充手段）
     */
    function _runRandomPerturbPhase(round, maxRounds, onProgress, onComplete) {
        if (round >= maxRounds) {
            _finishOptimization(onComplete);
            return;
        }
        _simState = _cloneSimState(_bestSimState);
        var newScore = _perturbAndRebuild();
        
        if (newScore > _bestScore) {
            _bestScore = newScore;
            _bestSimState = _cloneSimState(_simState);
            _simState = _cloneSimState(_bestSimState);
            _climbRecipeSwap();
            var ss = _fastCalcScore();
            if (ss > _bestScore) { _bestScore = ss; _bestSimState = _cloneSimState(_simState); }
            _runClimbingPhase(0, function() {
                setTimeout(function() { _runRandomPerturbPhase(round + 1, maxRounds, onProgress, onComplete); }, 2);
            }, onProgress);
        } else {
            setTimeout(function() { _runRandomPerturbPhase(round + 1, maxRounds, onProgress, onComplete); }, 2);
        }
    }

    function _runClimbingPhase(round, onDone, onProgress) {
        if (round >= CONFIG.maxRounds) {
            if (typeof onDone === 'function') onDone();
            return;
        }
        
        _simState = _cloneSimState(_bestSimState);
        var scoreBefore = _bestScore;
        var chefImproved = false, swapImproved = false, recipeImproved = false, recipeSwapImproved = false, jointImproved = false;
        
        // 每个操作独立setTimeout，避免阻塞浏览器
        // Step 1: 厨师爬山
        setTimeout(function() {
            chefImproved = _climbChefs();
            
            // Step 2: 厨师交换
            setTimeout(function() {
                _simState = _cloneSimState(_bestSimState);
                swapImproved = _climbChefSwap();
                
                // Step 3: 菜谱爬山
                setTimeout(function() {
                    _simState = _cloneSimState(_bestSimState);
                    recipeImproved = _climbRecipes();
                    
                    // Step 4: 菜谱交换
                    setTimeout(function() {
                        _simState = _cloneSimState(_bestSimState);
                        recipeSwapImproved = _climbRecipeSwap();
                        
                        // Step 5: 厨师+菜谱联合替换（同时换厨师和菜谱，发现单独换找不到的组合）
                        setTimeout(function() {
                            _simState = _cloneSimState(_bestSimState);
                            jointImproved = _climbJointChefRecipe();
                        
                            // 爬山后检查：分数和饱食度都达标时结束
                            if (_isTargetReachedWithSatiety()) {
                                if (typeof onDone === 'function') onDone();
                                return;
                            }
                            
                            if (!chefImproved && !recipeImproved && !swapImproved && !recipeSwapImproved && !jointImproved) {
                                if (typeof onDone === 'function') onDone();
                            } else {
                                setTimeout(function() {
                                    _runClimbingPhase(round + 1, onDone, onProgress);
                                }, 2);
                            }
                        }, 0);
                    }, 0);
                }, 0);
            }, 0);
        }, 0);
    }

    // ==================== 完成：写回系统 ====================

    function _finishOptimization(onComplete) {
        // 防止重复调用
        if (!_isRunning) return;
        
        // 停止匀速进度定时器
        _stopProgressTimer();
        
        // 将最佳模拟状态写回系统（这里才触碰DOM）
        var memTotal = 0;
        if (_bestSimState) {
            // 先恢复到最佳状态
            _simState = _bestSimState;
            
            // 补充缺失的厨师：如果有位置没有厨师，用未使用的厨师补上并重选菜谱
            var usedChefIds = {};
            for (var ri = 0; ri < _rules.length; ri++) {
                if (!_shouldProcessRule(ri)) continue;  // 跳过不需要处理的贵客
                var rule = _rules[ri];
                var numChefs = rule.IntentList ? rule.IntentList.length : 3;
                for (var ci = 0; ci < numChefs; ci++) {
                    if (_simState[ri][ci].chefId) {
                        usedChefIds[_simState[ri][ci].chefId] = true;
                    }
                }
            }
            
            // 辅助函数：为指定位置优化菜谱（只替换厨师技法不达标的菜谱，保留能做的）
            function _fillRecipesWithSkillCheck(ri, ci) {
                var chefObj = _simState[ri][ci].chefObj;
                var usedRecipeIds = {};
                // 收集当前贵客已用的菜谱（排除当前位置）
                var rule = _rules[ri];
                var numChefs = rule.IntentList ? rule.IntentList.length : 3;
                for (var oci = 0; oci < numChefs; oci++) {
                    if (oci === ci) continue; // 排除当前位置
                    for (var oreci = 0; oreci < 3; oreci++) {
                        var r = _simState[ri][oci].recipes[oreci];
                        if (r && r.data) usedRecipeIds[r.data.recipeId] = true;
                    }
                }
                
                // 检查当前位置每个菜谱，只替换技法不达标的
                var skills = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
                for (var reci = 0; reci < 3; reci++) {
                    var currentRecipe = _simState[ri][ci].recipes[reci];
                    var needReplace = false;
                    
                    if (!currentRecipe || !currentRecipe.data) {
                        // 没有菜谱，需要分配
                        needReplace = true;
                    } else if (chefObj) {
                        // 检查厨师技法是否足够做这道菜
                        for (var sk = 0; sk < skills.length; sk++) {
                            var s = skills[sk];
                            if (currentRecipe.data[s] > 0 && (!chefObj[s] || chefObj[s] < currentRecipe.data[s])) {
                                needReplace = true;
                                break;
                            }
                        }
                    }
                    
                    if (needReplace) {
                        // 清空当前菜谱
                        _simState[ri][ci].recipes[reci] = {data: null, quantity: 0, max: 0};
                        // 找能做的最高分菜谱
                        var recipeRanking = _fastGetRecipeRanking(ri, ci, reci, 50, true);
                        for (var rk = 0; rk < recipeRanking.length; rk++) {
                            var rd = recipeRanking[rk];
                            if (usedRecipeIds[rd.recipeId]) continue;
                            // 检查厨师技法是否足够
                            var canMake = true;
                            if (chefObj && rd.data) {
                                for (var sk = 0; sk < skills.length; sk++) {
                                    var s = skills[sk];
                                    if (rd.data[s] > 0 && (!chefObj[s] || chefObj[s] < rd.data[s])) {
                                        canMake = false;
                                        break;
                                    }
                                }
                            }
                            if (canMake) {
                                _simSetRecipe(ri, ci, reci, rd.recipeId);
                                usedRecipeIds[rd.recipeId] = true;
                                break;
                            }
                        }
                    } else {
                        // 保留当前菜谱，加入已用列表
                        usedRecipeIds[currentRecipe.data.recipeId] = true;
                    }
                }
            }
            
            // 第一轮：补充缺失厨师并分配菜谱
            var fixedPositions = [];
            for (var ri = 0; ri < _rules.length; ri++) {
                if (!_shouldProcessRule(ri)) continue;  // 跳过不需要处理的贵客
                var rule = _rules[ri];
                var numChefs = rule.IntentList ? rule.IntentList.length : 3;
                for (var ci = 0; ci < numChefs; ci++) {
                    if (!_simState[ri][ci].chefId) {
                        var chefRanking = _fastGetChefRanking(ri, ci, true);
                        for (var j = 0; j < chefRanking.length; j++) {
                            if (!usedChefIds[chefRanking[j].chefId]) {
                                _simSetChef(ri, ci, chefRanking[j].chefId);
                                usedChefIds[chefRanking[j].chefId] = true;
                                _fillRecipesWithSkillCheck(ri, ci);
                                fixedPositions.push({ri: ri, ci: ci});
                                break;
                            }
                        }
                    }
                }
            }
            
            // 第二轮：对每个位置单独迭代优化厨师和菜谱，直到收敛
            // 每次替换菜谱后重新查找最优厨师，循环直到不再改进
            var maxIterations = 10;
            for (var fi = 0; fi < fixedPositions.length; fi++) {
                var pos = fixedPositions[fi];
                var rule = _rules[pos.ri];
                var allChefs = rule.chefs || [];
                
                for (var iter = 0; iter < maxIterations; iter++) {
                    var currentChefId = _simState[pos.ri][pos.ci].chefId;
                    var currentScore = _calcRuleScore(pos.ri, true);
                    var bestScore = currentScore;
                    var bestChefId = currentChefId;
                    var bestRecipes = [];
                    for (var reci = 0; reci < 3; reci++) {
                        var r = _simState[pos.ri][pos.ci].recipes[reci];
                        bestRecipes.push(r && r.data ? r.data.recipeId : null);
                    }
                    
                    // 尝试每个未使用的厨师
                    for (var j = 0; j < allChefs.length; j++) {
                        var candidateId = allChefs[j].chefId;
                        // 跳过已被其他位置使用的厨师（但允许当前位置的厨师）
                        if (usedChefIds[candidateId] && candidateId !== currentChefId) continue;
                        // 跳过未拥有的厨师（如果启用了只用已有）
                        if (_cachedConfig.useGot && !allChefs[j].got) continue;
                        
                        // 换厨师并重新分配菜谱
                        _simSetChef(pos.ri, pos.ci, candidateId);
                        _fillRecipesWithSkillCheck(pos.ri, pos.ci);
                        var newScore = _calcRuleScore(pos.ri, true);
                        
                        if (newScore > bestScore) {
                            bestScore = newScore;
                            bestChefId = candidateId;
                            bestRecipes = [];
                            for (var reci = 0; reci < 3; reci++) {
                                var r = _simState[pos.ri][pos.ci].recipes[reci];
                                bestRecipes.push(r && r.data ? r.data.recipeId : null);
                            }
                        }
                    }
                    
                    // 应用本轮最佳结果
                    if (bestChefId !== currentChefId) {
                        usedChefIds[currentChefId] = false;
                        usedChefIds[bestChefId] = true;
                    }
                    _simSetChef(pos.ri, pos.ci, bestChefId);
                    for (var reci = 0; reci < 3; reci++) {
                        _simSetRecipe(pos.ri, pos.ci, reci, bestRecipes[reci]);
                    }
                    
                    // 如果没有改进，该位置收敛，进入下一个位置
                    if (bestScore <= currentScore) break;
                }
            }
            
            // 第三轮：如果饱食度不达标，调用现有的菜谱爬山函数
            if (!_isAllSatietyOk()) {
                // 先把当前状态设为最佳状态，这样爬山函数才能基于当前状态优化
                _bestSimState = _cloneSimState(_simState);
                _bestScore = _fastCalcScore();
                
                _climbRecipes();
                _simState = _cloneSimState(_bestSimState);
                _climbRecipeSwap();
            }
            
            // 更新最佳状态
            _bestSimState = _cloneSimState(_simState);
            _finalizeTargetQuantities();
            
            // 计算内存分数明细
            var memScores = [];
            for (var ri = 0; ri < _rules.length; ri++) {
                var rScore = _calcRuleScore(ri, true);
                memScores.push(rScore);
                memTotal += rScore;
            }
            _applySimStateToSystem(_bestSimState);
        }
        
        var totalTime = Date.now() - (_timeStats.startTime || Date.now());
        
        // 用系统函数算一次真实分数
        if (typeof calCustomResults === 'function') {
            calCustomResults(_gameData);
        }
        var finalScore = (typeof calCustomRule !== 'undefined' && calCustomRule) ? (calCustomRule.score || 0) : 0;
        
        if (memTotal > 0 && finalScore !== memTotal) {
        } else if (memTotal > 0) {
        }
        if (_targetScore) {
        }
        
        _bestResult = { score: finalScore };
        _isRunning = false;
        
        // 先调用完成回调（回调中的 applyResult 仍需要 _gameData 等数据）
        if (typeof onComplete === 'function') {
            onComplete({ success: true, score: finalScore, timeMs: totalTime, message: '优化完成' });
        }
        
        // 释放大对象，减少内存占用，避免影响后续操作（如导入数据）
        _simState = null;
        _bestSimState = null;
        _topCandidates = [];
        _intentCache = {};
        _recipeDependentIntentCache = {};
        _threeSkillIntentCache = {};
        _condimentIntentCache = {};
        _rarityRankIntentCache = {};
        _cookSkillIntentCache = {};
        _synergyCache = {};
        _intentAddCache = {};
        _priceAuraChefCache = {};
        _chefMap = {};
        _recipeMap = {};
        _menusByRule = [];
        _rules = [];
        _gameData = null;
        _cachedConfig = {};
    }

    /**
     * 将模拟状态写回系统（调用真正的setCustomChef/setCustomRecipe）
     */
    function _applySimStateToSystem(simState) {
        for (var ri = 0; ri < simState.length; ri++) {
            for (var ci = 0; ci < simState[ri].length; ci++) {
                var slot = simState[ri][ci];
                if (slot.chefId && typeof setCustomChef === 'function') {
                    setCustomChef(ri, ci, slot.chefId);
                }
                for (var reci = 0; reci < slot.recipes.length; reci++) {
                    if (slot.recipes[reci].data && typeof setCustomRecipe === 'function') {
                        setCustomRecipe(ri, ci, reci, slot.recipes[reci].data.recipeId);
                        if (typeof setCustomRecipeQuantity === 'function') {
                            setCustomRecipeQuantity(ri, ci, reci, slot.recipes[reci].quantity || 0);
                        }
                    }
                }
            }
        }
    }

    // ==================== 公共接口 ====================

    function applyResult() {
        if (typeof calCustomResults === 'function') {
            calCustomResults(_gameData);
        }
        var score = (typeof calCustomRule !== 'undefined' && calCustomRule) ? (calCustomRule.score || 0) : 0;
        return { actualScore: score };
    }

    function isRunning() { return _isRunning; }
    function getBestResult() { return _bestResult; }
    
    function setGuestFilter(guestIndex) {
        _guestFilter = guestIndex;
    }
    
    function getGuestFilter() { return _guestFilter; }
    
    return {
        init: init,
        optimize: optimize,
        isRunning: isRunning,
        getBestResult: getBestResult,
        applyResult: applyResult,
        setGuestFilter: setGuestFilter,
        getGuestFilter: getGuestFilter,
        BANQUET_LEVELS: BANQUET_LEVELS,
        BANQUET_TIER_SCORES: BANQUET_TIER_SCORES,
        JIANGHU_TIER_SCORES: JIANGHU_TIER_SCORES,
        XIANKE_TIER_SCORES: XIANKE_TIER_SCORES,
        findTierScoreKey: _findTierScoreKey,
        getTierScore: _getTierScore
    };
})();
