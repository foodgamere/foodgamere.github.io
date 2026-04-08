/**
 * 一键查询模块
 * One-Click Query Module
 * 
 * @version 2.0.0
 * @description 实现与 show 项目相同的一键查询功能
 *              复用 query.cultivate.js 中的品级计算、技法差值计算、光环厨师优化等函数
 * 
 * @dependencies
 * - jQuery (必需)
 * - Bootstrap Selectpicker (必需)
 * - GuestRateCalculator (必需)
 * - CalCustomRule 全局对象 (必需)
 * - query.cultivate.js 中的函数:
 *   - calculateRecipeRank(chef, recipe)
 *   - calculateSkillDiffForQuestRecipe(chef, recipe)
 *   - getEquipSkillBonus(equip)
 *   - createEmptySkillBonus()
 */

var OneClickQuery = (function($) {
    'use strict';
    
    // ========================================
    // 常量定义
    // ========================================
    
    /**
     * 符文列表常量
     */
    var GOLD_RUNES = ['恐怖利刃', '鼓风机', '蒸馏杯', '千年煮鳖', '香烤鱼排', '五星炒果'];
    var SILVER_RUNES = ['刀嘴鹦鹉', '一昧真火', '蒸汽宝石', '耐煮的水草', '焦虫', '暖石'];
    var BRONZE_RUNES = ['剪刀蟹', '油火虫', '蒸汽耳环', '防水的柠檬', '烤焦的菊花', '五香果'];
    /**
     * 星级对应的最低份数要求
     */
    var MIN_QUANTITY_MAP = {
        1: 20,  // 1星最低20份
        2: 15,  // 2星最低15份
        3: 12,  // 3星最低12份
        4: 10,  // 4星最低10份
        5: 7    // 5星最低7份
    };
    
    /**
     * 星级对应的最大份数限制（基础值，不含修炼加成）
     */
    var BASE_MAX_QUANTITY_MAP = {
        1: 40,  // 1星基础最大40份
        2: 30,  // 2星基础最大30份
        3: 25,  // 3星基础最大25份
        4: 20,  // 4星基础最大20份
        5: 15   // 5星基础最大15份
    };
    
    /**
     * 技法类型常量
     */
    var SKILL_TYPES = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    
    /**
     * 获取用户实际的最大份数（包含修炼加成和规则加成）
     * @param {number} starLevel - 菜谱星级 (1-5)
     * @returns {number} 实际最大份数
     */
    function getUserMaxQuantity(starLevel) {
        var baseMax = BASE_MAX_QUANTITY_MAP[starLevel] || 15;
        var ultimateBonus = 0;
        var ruleBonus = 0;
        
        // 从 calCustomRule.rules[0].calGlobalUltimateData 获取修炼加成
        if (typeof calCustomRule !== 'undefined' && calCustomRule.rules && calCustomRule.rules[0]) {
            var rule = calCustomRule.rules[0];
            
            // 获取修炼加成 (MaxEquipLimit)
            if (rule.calGlobalUltimateData && Array.isArray(rule.calGlobalUltimateData)) {
                for (var i = 0; i < rule.calGlobalUltimateData.length; i++) {
                    var data = rule.calGlobalUltimateData[i];
                    if (data.type === 'MaxEquipLimit' && data.rarity === starLevel) {
                        ultimateBonus = data.value || 0;
                        break;
                    }
                }
            }
            
            // 获取规则加成 (skill.MaxLimit)
            if (rule.skill && rule.skill.MaxLimit) {
                ruleBonus = Number(rule.skill.MaxLimit[starLevel]) || 0;
            }
        }
        
        var totalMax = baseMax + ultimateBonus + ruleBonus;
        
        return totalMax;
    }

    /**
     * 技能效果类型映射（公共常量，避免重复定义）
     */
    var SKILL_EFFECT_MAP = {
        "Stirfry": "stirfry",
        "Boil": "boil",
        "Knife": "knife",
        "Fry": "fry",
        "Bake": "bake",
        "Steam": "steam",
    };

    /**
     * 技能效果类型映射（布尔版本，用于类型检查）
     */
    var SKILL_EFFECT_TYPE_CHECK = {
        "Stirfry": true,
        "Boil": true,
        "Knife": true,
        "Fry": true,
        "Bake": true,
        "Steam": true
    };

    /**
     * 默认设置
     */
    var DEFAULT_SETTINGS = {
        defaultTime: 8.0,                // 制作时间（小时）
        queryMode: true,                 // 查询模式：true=查询效率，false=查询必来
        useExistingConfig: true,         // 使用场上已有配置：true=使用场上厨师/厨具/心法盘，false=每次重新筛选
        singleRecipePerRune: false,      // 每种符文只查一个菜谱
        goldRuneSelections: [],          // 金符文选择
        silverRuneSelections: [],        // 银符文选择
        bronzeRuneSelections: [],        // 铜符文选择
        goldRuneExpanded: false,         // 金符文展开状态
        silverRuneExpanded: false,       // 银符文展开状态
        bronzeRuneExpanded: false        // 铜符文展开状态
    };
    
    // ========================================
    // 私有变量
    // ========================================
    
    var settings = $.extend({}, DEFAULT_SETTINGS);
    var isQueryInProgress = false;
    var jadeRankingTableDataCache = null;
    var jadeRankingTableLoading = false;
    var jadeRankingTablePendingCallbacks = [];
    var jadeRecipeValueMapCache = {};
    var jadeRecipeValueMapLoaded = false;

    // ========================================
    // 设置存储函数
    // ========================================
    
    /**
     * 从 localStorage 加载设置
     */
    function loadSettings() {
        try {
            var stored = localStorage.getItem('oneclick_query_settings');
            if (stored) {
                var parsed = JSON.parse(stored);
                settings = $.extend({}, DEFAULT_SETTINGS, parsed);
                // 强制更新默认时间为8小时（如果用户之前保存的是7小时）
                if (parsed.defaultTime === 7.0 || parsed.defaultTime === 7) {
                    settings.defaultTime = 8.0;
                    saveSettings();
                }
            }
        } catch (e) {
            console.error('加载一键查询设置失败:', e);
        }
        return settings;
    }
    
    /**
     * 保存设置到 localStorage
     */
    function saveSettings() {
        try {
            localStorage.setItem('oneclick_query_settings', JSON.stringify(settings));
        } catch (e) {
            console.error('保存一键查询设置失败:', e);
        }
    }
    
    /**
     * 获取设置值
     */
    function getSetting(key) {
        return settings[key];
    }
    
    /**
     * 设置值
     */
    function setSetting(key, value) {
        settings[key] = value;
        saveSettings();
    }

    function normalizeJadeRecipeValueMap(data) {
        var map = {};
        if (!data) {
            return map;
        }

        if ($.isArray(data)) {
            for (var i = 0; i < data.length; i++) {
                var item = data[i];
                if (!item || !item.name) {
                    continue;
                }
                var recipeName = $.trim(String(item.name));
                var jadeValue = Number(item.value);
                if (!recipeName || isNaN(jadeValue)) {
                    continue;
                }
                map[recipeName] = jadeValue;
            }
            return map;
        }

        for (var key in data) {
            if (!data.hasOwnProperty(key)) {
                continue;
            }
            var normalizedName = $.trim(String(key));
            var normalizedValue = Number(data[key]);
            if (!normalizedName || isNaN(normalizedValue)) {
                continue;
            }
            map[normalizedName] = normalizedValue;
        }

        return map;
    }

    function loadJadeRecipeValueMap(forceReload) {
        if (jadeRecipeValueMapLoaded && !forceReload) {
            return;
        }

        $.ajax({
            url: 'data/jade-values.json?v=' + Date.now(),
            dataType: 'json',
            cache: false
        }).done(function(data) {
            jadeRecipeValueMapCache = normalizeJadeRecipeValueMap(data);
            jadeRecipeValueMapLoaded = true;
        }).fail(function() {
            jadeRecipeValueMapCache = {};
            jadeRecipeValueMapLoaded = true;
        });
    }

    function ensureJadeRecipeValueMapLoaded() {
        if (jadeRecipeValueMapLoaded) {
            return;
        }

        $.ajax({
            url: 'data/jade-values.json?v=' + Date.now(),
            dataType: 'json',
            cache: false,
            async: false
        }).done(function(data) {
            jadeRecipeValueMapCache = normalizeJadeRecipeValueMap(data);
            jadeRecipeValueMapLoaded = true;
        }).fail(function() {
            jadeRecipeValueMapCache = {};
            jadeRecipeValueMapLoaded = true;
        });
    }

    function getJadeRecipeValue(recipeName) {
        if (!recipeName) {
            return 0;
        }
        ensureJadeRecipeValueMapLoaded();
        return Number(jadeRecipeValueMapCache[recipeName]) || 0;
    }

    function flushJadeRankingTableCallbacks(data, error) {
        var callbacks = jadeRankingTablePendingCallbacks.slice();
        jadeRankingTablePendingCallbacks = [];
        for (var i = 0; i < callbacks.length; i++) {
            callbacks[i](data, error);
        }
    }

    function preloadJadeRankingTableData(forceReload, callback) {
        if (jadeRankingTableDataCache && !forceReload) {
            if (typeof callback === 'function') {
                callback(jadeRankingTableDataCache, null);
            }
            return;
        }

        if (typeof callback === 'function') {
            jadeRankingTablePendingCallbacks.push(callback);
        }

        if (jadeRankingTableLoading) {
            return;
        }

        jadeRankingTableLoading = true;
        if (forceReload) {
            jadeRankingTableDataCache = null;
        }

        $.ajax({
            url: 'data/jade-ranking-table.json?v=' + Date.now(),
            dataType: 'json',
            cache: false
        }).done(function(response) {
            jadeRankingTableDataCache = response;
            jadeRankingTableLoading = false;
            flushJadeRankingTableCallbacks(response, null);
        }).fail(function(xhr, status, error) {
            jadeRankingTableLoading = false;
            flushJadeRankingTableCallbacks(null, error || status || 'load_failed');
        });
    }

    // ========================================
    // 辅助函数 - 复用或本地实现
    // ========================================
    
    /**
     * 创建空的技法加成对象（如果全局函数不存在则使用本地实现）
     */
    function getEmptySkillBonus() {
        if (typeof createEmptySkillBonus === 'function') {
            return createEmptySkillBonus();
        }
        return { stirfry: 0, boil: 0, knife: 0, fry: 0, bake: 0, steam: 0 };
    }
    
    /**
     * 获取厨具的技法加成（如果全局函数不存在则使用本地实现）
     */
    function getEquipBonus(equip) {
        if (typeof getEquipSkillBonus === 'function') {
            return getEquipSkillBonus(equip);
        }
        var bonus = getEmptySkillBonus();
        if (!equip || !equip.effect) return bonus;
        
        for (var i = 0; i < equip.effect.length; i++) {
            var effect = equip.effect[i];
            if (effect.condition && effect.condition !== "Self") continue;
            var skill = SKILL_EFFECT_MAP[effect.type];
            if (skill && skill !== "all") {
                bonus[skill] += effect.value || 0;
            }
        }
        return bonus;
    }

    /**
     * 计算品级评分（公共函数，避免重复代码）
     * @param {number} rank - 品级 (4=神, 3=特, 2=优, 1=可, 0=无法制作)
     * @returns {number} 品级评分
     */
    function calculateQualityScore(rank) {
        if (rank >= 4) return 400;      // 神级或传级
        else if (rank === 3) return 300; // 特级
        else if (rank === 2) return 200;  // 优级
        else if (rank === 1) return 100;   // 可级
        else return -999999;              // 无法制作
    }

    /**
     * 计算菜谱综合评分（公共函数，避免重复代码）
     * @param {Object} recipe - 菜谱对象
     * @param {number} rank - 品级
     * @param {number} guestCount - 贵客数量
     * @returns {number} 综合评分
     */
    function calculateRecipeScore(recipe, rank, guestCount) {
        var qualityScore = calculateQualityScore(rank);
        // 时间评分：双贵客菜谱时间除以2
        var adjustedTime = (guestCount >= 2) ? Math.floor((recipe.time || 0) / 2) : (recipe.time || 0);
        // 分配菜谱时优先看用时，其次再看品级
        // 这样不会为了较高品级而强行选择明显更慢的菜
        var timeScore = -adjustedTime * 1000;
        return timeScore + qualityScore + guestCount;
    }

    /**
     * 为指定符文查找当前可分配的最优菜谱与厨师
     * 会基于当前已分配的菜谱和厨师空位实时计算，避免使用过期候选
     */
    function findBestRecipeAssignmentForRune(rune, runeRecipes, enhancedChefs, usedRecipeIds, gameData) {
        if (!runeRecipes || runeRecipes.length === 0) {
            return null;
        }

        var bestRecipe = null;
        var bestScore = -999999;
        var bestChefIndex = -1;
        var bestRank = 0;
        var bestGuestCount = 1;
        var bestChefLoad = 999999;

        for (var ri = 0; ri < runeRecipes.length; ri++) {
            var recipe = runeRecipes[ri];

            if (usedRecipeIds[recipe.recipeId]) {
                continue;
            }

            var guestCount = getRecipeGuestCount(recipe, gameData);

            for (var c = 0; c < enhancedChefs.length; c++) {
                var chefLoad = enhancedChefs[c].recipes.length;
                if (chefLoad >= 3) {
                    continue;
                }

                var enhancedChef = enhancedChefs[c].enhanced;
                var rank = getRecipeRank(enhancedChef, recipe);

                if (rank === 0) {
                    continue;
                }

                var chefHasDivineSkill = hasDivineRecipeSkill(enhancedChef);
                if (chefHasDivineSkill && rank < 4) {
                    continue;
                }

                var totalScore = calculateRecipeScore(recipe, rank, guestCount);
                var shouldReplace = false;

                if (totalScore > bestScore) {
                    shouldReplace = true;
                } else if (totalScore === bestScore) {
                    if (chefLoad < bestChefLoad) {
                        shouldReplace = true;
                    } else if (chefLoad === bestChefLoad && bestRecipe && (recipe.time || 0) < (bestRecipe.time || 0)) {
                        shouldReplace = true;
                    }
                }

                if (shouldReplace) {
                    bestScore = totalScore;
                    bestRecipe = recipe;
                    bestChefIndex = c;
                    bestRank = rank;
                    bestGuestCount = guestCount;
                    bestChefLoad = chefLoad;
                }
            }
        }

        if (!bestRecipe || bestChefIndex < 0) {
            return null;
        }

        return {
            rune: rune,
            recipe: bestRecipe,
            score: bestScore,
            bestChefIndex: bestChefIndex,
            bestRank: bestRank,
            guestCount: bestGuestCount
        };
    }
    
    /**
     * 计算厨师做菜谱能达到的品级（复用全局函数或本地实现）
     * 返回：4=神, 3=特, 2=优, 1=可, 0=无法制作
     */
    function getRecipeRank(chef, recipe) {
        if (typeof calculateRecipeRank === 'function') {
            return calculateRecipeRank(chef, recipe);
        }
        // 本地实现
        var minRank = 4;
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            var recipeNeed = recipe[skill] || 0;
            if (recipeNeed > 0) {
                var chefVal = chef[skill + 'Val'] || 0;
                var rank = 0;
                if (chefVal >= recipeNeed * 4) rank = 4;
                else if (chefVal >= recipeNeed * 3) rank = 3;
                else if (chefVal >= recipeNeed * 2) rank = 2;
                else if (chefVal >= recipeNeed) rank = 1;
                if (rank < minRank) minRank = rank;
            }
        }
        return minRank;
    }
    
    /**
     * 计算厨师做菜谱的神差值（达到神级需要的技法差值总和）
     */
    function getSkillDiff(chef, recipe) {
        if (typeof calculateSkillDiffForQuestRecipe === 'function') {
            return calculateSkillDiffForQuestRecipe(chef, recipe);
        }
        // 本地实现
        var totalDiff = 0;
        var godMultiplier = 4;
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            var recipeNeed = recipe[skill] || 0;
            if (recipeNeed > 0) {
                var chefVal = chef[skill + 'Val'] || 0;
                var required = recipeNeed * godMultiplier;
                var diff = required - chefVal;
                if (diff > 0) totalDiff += diff;
            }
        }
        return totalDiff;
    }

    /**
     * 应用技法加成到厨师
     */
    function applySkillBonus(chef, bonus) {
        var boosted = JSON.parse(JSON.stringify(chef));
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            boosted[skill + 'Val'] = (boosted[skill + 'Val'] || 0) + (bonus[skill] || 0);
        }
        return boosted;
    }
    
    // ========================================
    // 份数计算函数
    // ========================================
    
    /**
     * 根据贵客率和星级获取必来份数（使用公式精确计算）
     * 
     * 贵客率公式（来自 guest.calculator.js）：
     * - 1星: actualRate = (0.05 + (quantity - 20) * 0.013) * (100 + baseGuestRate)
     * - 2星: actualRate = (0.08 + (quantity - 15) * 0.02) * (100 + baseGuestRate)
     * - 3星: actualRate = (0.083 + (quantity - 12) * 0.016) * (100 + baseGuestRate)
     * - 4星: actualRate = (0.1142 + (quantity - 10) * 0.0059) * (100 + baseGuestRate)
     * - 5星: actualRate = (0.1006 + (quantity - 7) * 0.0084) * (100 + baseGuestRate)
     * 
     * 反推公式（令 actualRate = 100）：
     * quantity = (100 / (100 + baseGuestRate) - baseCoeff) / stepCoeff + baseQuantity
     * 
     * @param {number} totalGuestRate - 总贵客率（百分比，如 254 表示 254%）
     * @param {number} starLevel - 菜谱星级 (1-5)
     * @returns {number} 必来份数（向上取整）
     */
    function getRequiredPortionsForStarLevel(totalGuestRate, starLevel) {
        // 各星级的公式参数：baseCoeff（基础系数）、stepCoeff（每份增加系数）、baseQuantity（基础份数）
        var formulaParams = {
            1: { baseCoeff: 0.05, stepCoeff: 0.013, baseQuantity: 20 },
            2: { baseCoeff: 0.08, stepCoeff: 0.02, baseQuantity: 15 },
            3: { baseCoeff: 0.083, stepCoeff: 0.016, baseQuantity: 12 },
            4: { baseCoeff: 0.1142, stepCoeff: 0.0059, baseQuantity: 10 },
            5: { baseCoeff: 0.1006, stepCoeff: 0.0084, baseQuantity: 7 }
        };
        
        var params = formulaParams[starLevel];
        if (!params) {
            console.warn('未知星级:', starLevel, '，使用5星参数');
            params = formulaParams[5];
        }
        
        // totalGuestRate 是百分比形式（如 254），公式中的 baseGuestRate 也是百分比形式
        // 公式：actualRate = (baseCoeff + (quantity - baseQuantity) * stepCoeff) * (100 + baseGuestRate)
        // 令 actualRate = 100（即100%贵客率），反推 quantity：
        // 100 = (baseCoeff + (quantity - baseQuantity) * stepCoeff) * (100 + baseGuestRate)
        // 100 / (100 + baseGuestRate) = baseCoeff + (quantity - baseQuantity) * stepCoeff
        // (100 / (100 + baseGuestRate) - baseCoeff) / stepCoeff = quantity - baseQuantity
        // quantity = (100 / (100 + baseGuestRate) - baseCoeff) / stepCoeff + baseQuantity
        
        var targetRate = 100; // 目标贵客率 100%
        var rateMultiplier = 100 + totalGuestRate; // 100 + 254 = 354
        
        var requiredCoeff = targetRate / rateMultiplier; // 100 / 354 ≈ 0.2825
        var quantity = (requiredCoeff - params.baseCoeff) / params.stepCoeff + params.baseQuantity;
        
        // 向上取整，确保能达到100%贵客率
        var result = Math.ceil(quantity);
        
        // 确保不低于最低份数
        var minQuantity = MIN_QUANTITY_MAP[starLevel] || 7;
        if (result < minQuantity) {
            result = minQuantity;
        }
        
        return result;
    }
    
    /**
     * 处理厨师的心法盘数据，根据页面开关配置
     * @param {Object} chef - 厨师对象
     * @param {boolean} useAmber - 是否使用已配遗玉
     * @param {boolean} maxDisk - 是否使用默认满级心法盘
     * @param {Object} rule - 规则对象（包含ambers数据）
     * @param {boolean} isGuestRateMode - 是否是贵客率计算模式
     * @returns {Object} 处理后的厨师对象（可能是副本）
     */
    function processChefDiskForCalc(chef, useAmber, maxDisk, rule, isGuestRateMode) {
        if (!chef) return chef;
        
        // 如果不使用遗玉且不使用满级心法盘，直接删除disk
        if (!useAmber && !maxDisk) {
            var chefCopy = JSON.parse(JSON.stringify(chef));
            delete chefCopy.disk;
            return chefCopy;
        }
        
        // 如果使用满级心法盘
        if (maxDisk) {
            var chefCopy = JSON.parse(JSON.stringify(chef));
            
            // 贵客率模式下，默认满级心法盘优先级最高，忽略已配遗玉设置
            if (isGuestRateMode) {
                if (chefCopy.disk) {
                    // 设置心法盘等级为满级
                    chefCopy.disk.level = chefCopy.disk.maxLevel || 5;
                    
                    // 获取默认蓝色心法盘数据（amberId=75）
                    var defaultBlueAmber = null;
                    if (rule && rule.ambers) {
                        for (var i = 0; i < rule.ambers.length; i++) {
                            if (rule.ambers[i].amberId === 75) {
                                defaultBlueAmber = rule.ambers[i];
                                break;
                            }
                        }
                    }
                    
                    // 遍历心法盘槽位，只保留蓝色槽位（type=3）并设置为默认蓝色心法盘
                    if (chefCopy.disk.ambers) {
                        for (var a = 0; a < chefCopy.disk.ambers.length; a++) {
                            var slot = chefCopy.disk.ambers[a];
                            if (slot.type === 3) {
                                // 蓝色槽位：设置为默认蓝色心法盘
                                slot.data = defaultBlueAmber;
                            } else {
                                // 非蓝色槽位：清空数据
                                slot.data = null;
                            }
                        }
                    }
                }
            } else if (!useAmber) {
                // 非贵客率模式 + 不勾选"已配遗玉"
                if (chefCopy.disk) {
                    // 设置心法盘等级为满级
                    chefCopy.disk.level = chefCopy.disk.maxLevel || 5;
                    
                    // 非贵客率模式：只清空遗玉数据，不设置默认蓝色心法盘
                    if (chefCopy.disk.ambers) {
                        for (var a = 0; a < chefCopy.disk.ambers.length; a++) {
                            chefCopy.disk.ambers[a].data = null;
                        }
                    }
                }
            } else {
                // 非贵客率模式 + 勾选"已配遗玉"：
                // 使用厨师当前心法盘，但设置为满级
                if (chefCopy.disk) {
                    chefCopy.disk.level = chefCopy.disk.maxLevel || 5;
                }
            }
            
            return chefCopy;
        }
        
        // 只使用遗玉，不使用满级心法盘：保持原样
        return chef;
    }

    /**
     * 计算菜谱份数
     * @param {Object} recipe - 菜谱对象
     * @param {number} totalGuestRate - 总贵客率
     * @param {boolean} isSupplemented - 是否为强补菜谱
     * @returns {Object} {quantity: 分配份数, canAchieveBilai: 是否能达到必来, requiredPortions: 必来份数, maxQuantity: 最大份数}
     */
    function calculateRecipeQuantity(recipe, totalGuestRate, isSupplemented) {
        // 如果是强补菜谱，份数始终为1
        if (isSupplemented) {
            return { quantity: 1, canAchieveBilai: true, requiredPortions: 1, maxQuantity: 1 };
        }
        
        var starLevel = recipe.rarity || 5;
        var isQueryEfficiencyMode = settings.queryMode;
        
        if (isQueryEfficiencyMode) {
            // 查询效率模式：根据菜谱星级固定份数
            var quantity;
            switch (starLevel) {
                case 5: quantity = 7; break;   // 五星菜谱7份
                case 4: quantity = 10; break;  // 四星菜谱10份
                case 3: quantity = 12; break;  // 三星菜谱12份
                case 2: quantity = 15; break;  // 二星菜谱15份
                case 1: quantity = 20; break;  // 一星菜谱20份
                default: quantity = 20; break; // 默认20份
            }
            return { quantity: quantity, canAchieveBilai: true, requiredPortions: quantity, maxQuantity: quantity };
        } else {
            // 查询必来模式：根据菜谱星级和贵客率查表确定份数
            var requiredPortions = getRequiredPortionsForStarLevel(totalGuestRate, starLevel);
            // 获取该星级的最大份数限制（用于判断是否能达到必来）
            var maxQuantity = getUserMaxQuantity(starLevel);
            // 检查是否能达到必来
            var canAchieveBilai = requiredPortions <= maxQuantity;
            // 直接使用必来份数，不限制最大份数（会在提示中告知用户）
            return { quantity: requiredPortions, canAchieveBilai: canAchieveBilai, requiredPortions: requiredPortions, maxQuantity: maxQuantity };
        }
    }
    
    /**
     * 计算制作时间（秒）
     * @param {number} recipeTime - 菜谱单份时间（秒）
     * @param {number} quantity - 份数
     * @param {number} timeBonus - 时间加成（百分比，负数表示减少时间）
     * @returns {number} 总制作时间（秒）
     */
    function calculateCookingTime(recipeTime, quantity, timeBonus) {
        var baseTime = recipeTime * quantity;
        var bonusMultiplier = 1 + (timeBonus || 0) / 100;
        return Math.floor(baseTime * bonusMultiplier);
    }
    
    /**
     * 合并两个技法加成
     */
    function combineSkillBonus(bonus1, bonus2) {
        var result = getEmptySkillBonus();
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            result[skill] = (bonus1[skill] || 0) + (bonus2[skill] || 0);
        }
        return result;
    }
    
    /**
     * 获取技法加成总值
     */
    function getTotalSkillBonus(bonus) {
        var total = 0;
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            total += bonus[SKILL_TYPES[i]] || 0;
        }
        return total;
    }

    // ========================================
    // 厨师筛选和排序函数
    // ========================================
    
    /**
     * 分析厨师的贵客率相关技能
     * @param {Object} chef - 厨师对象
     * @param {boolean} useEquip - 是否使用厨具
     * @returns {Object} 技能分析结果
     */
    function analyzeChefSkills(chef, useEquip) {
        var result = {
            guestRate: 0,
            critRate: 0,
            timeBonus: 0,
            runeRate: 0,
            hasCritSkill: false,
            hasAssassinSkill: false,
            skillBonus: getEmptySkillBonus()
        };
        
        if (!chef) return result;
        
        // 分析厨师技能
        if (chef.specialSkillEffect) {
            for (var i = 0; i < chef.specialSkillEffect.length; i++) {
                analyzeSkillEffect(chef.specialSkillEffect[i], result, chef.specialSkillDisp);
            }
        }
        
        // 分析修炼技能（使用厨师自身的修炼状态）
        if (chef.ultimate === "是") {
            if (chef.ultimateSkillEffect) {
                for (var i = 0; i < chef.ultimateSkillEffect.length; i++) {
                    analyzeSkillEffect(chef.ultimateSkillEffect[i], result, chef.ultimateSkillDisp);
                }
            }
        }
        
        // 分析厨具技能（使用厨师自身佩戴的厨具）
        if (useEquip && chef.equip && chef.equip.effect) {
            for (var i = 0; i < chef.equip.effect.length; i++) {
                analyzeSkillEffect(chef.equip.effect[i], result, chef.equip.skillDisp);
            }
        }
        
        return result;
    }

    /**
     * 分析单个技能效果
     */
    function analyzeSkillEffect(skill, result, desc) {
        if (!skill || !skill.type) return;
        desc = desc || '';
        
        switch (skill.type) {
            case 'GuestApearRate':
                if (skill.value) result.guestRate += skill.value;
                break;
                
            case 'GuestDropCount':
                result.hasCritSkill = true;
                var percentMatch = desc.match(/稀有客人赠礼数量(\d+)%/);
                if (percentMatch) {
                    var basePercent = parseInt(percentMatch[1]);
                    var multiplier = (skill.value || 100) / 100;
                    result.critRate += basePercent * multiplier;
                }
                break;
                
            case 'OpenTime':
                if (skill.value) {
                    result.timeBonus += skill.value;
                    if (skill.value < 0) result.hasAssassinSkill = true;
                }
                break;
                
            case 'GuestAntiqueDropRate':
                if (skill.value) result.runeRate += skill.value / 10;
                break;
                
            default:
                // 技法加成类型（使用公共常量）
                var skillType = SKILL_EFFECT_MAP[skill.type];
                if (skillType && skill.value && skill.condition !== 'Next') {
                    result.skillBonus[skillType] += skill.value;
                }
                if (skill.value && skill.condition !== 'Next') {
                    for (var i = 0; i < SKILL_TYPES.length; i++) {
                        result.skillBonus[SKILL_TYPES[i]] += skill.value;
                    }
                }
                break;
        }
    }

    /**
     * 检查厨师是否有"每制作一种神级料理贵客赠礼翻倍概率"技能
     * @param {Object} chef - 厨师对象
     * @returns {boolean} 是否有该技能
     */
    function hasDivineRecipeSkill(chef) {
        // 检查厨师技能描述
        var skillDesc = (chef.specialSkillDisp || '') + ' ' + (chef.ultimateSkillDisp || '');
        
        // 检查是否包含"每制作一种神级料理贵客赠礼翻倍概率"技能
        return skillDesc.indexOf('每制作一种神级料理贵客赠礼翻倍概率') >= 0;
    }

    /**
     * 计算菜谱的贵客数量（用于双贵客菜谱时间优化）
     * @param {Object} recipe - 菜谱对象
     * @param {Object} gameData - 游戏数据
     * @returns {number} 贵客数量
     */
    function getRecipeGuestCount(recipe, gameData) {
        if (!gameData || !gameData.guests) return 1;
        
        var count = 0;
        for (var i = 0; i < gameData.guests.length; i++) {
            var guest = gameData.guests[i];
            if (!guest.gifts) continue;
            
            for (var j = 0; j < guest.gifts.length; j++) {
                if (guest.gifts[j].recipe === recipe.name) {
                    count++;
                    break; // 每个贵客只计算一次
                }
            }
        }
        
        return count || 1;
    }

    /**
     * 获取排序后的厨师列表
     * 调用 GuestRateCalculator.getFilteredAndSortedChefs 进行筛选和排序
     * @param {Array} chefs - 厨师列表
     * @param {boolean} onlyShowOwned - 只显示已拥有
     * @param {boolean} onlyShowCrit - 查询暴击模式
     * @param {boolean} onlyShowAssassin - 查询刺客模式
     * @param {boolean} onlyShowRune - 查询符文模式
     * @returns {Array} 排序后的厨师列表
     */
    function getSortedChefs(chefs, onlyShowOwned, onlyShowCrit, onlyShowAssassin, onlyShowRune) {
        if (!chefs || !chefs.length) return [];
        
        // 检查 GuestRateCalculator 是否可用
        if (typeof GuestRateCalculator === 'undefined' || 
            typeof GuestRateCalculator.getFilteredAndSortedChefs !== 'function') {
            console.error('GuestRateCalculator.getFilteredAndSortedChefs 不可用');
            return [];
        }
        
        // 确定分类类型
        var categoryType = 'guest'; // 默认贵客
        if (onlyShowCrit) {
            categoryType = 'crit';
        } else if (onlyShowAssassin) {
            categoryType = 'time';
        } else if (onlyShowRune) {
            categoryType = 'rune';
        }
        
        // 获取配置数据
        var qixiaData = null;
        if (typeof calCustomRule !== 'undefined' && calCustomRule.rules && calCustomRule.rules[0]) {
            qixiaData = calCustomRule.rules[0].calQixiaData;
        }
        var localData = typeof getLocalData === 'function' ? getLocalData() : null;
        var configUltimatedIds = typeof getConfigUltimatedChefIds === 'function' ? getConfigUltimatedChefIds() : null;
        
        // 读取页面上的"已配遗玉"和"已配厨具"开关状态
        var useAmberFromPage = $('#chk-cal-use-amber').is(':checked');
        var useEquipFromPage = $('#chk-cal-use-equip').is(':checked');
        
        var options = {
            qixiaData: qixiaData,
            useEquip: useEquipFromPage,  // 使用页面开关控制
            useAmber: useAmberFromPage,  // 使用页面开关控制
            localData: localData,
            configUltimatedIds: configUltimatedIds
        };
        
        // 调用 GuestRateCalculator 的函数
        var result = GuestRateCalculator.getFilteredAndSortedChefs(chefs, categoryType, onlyShowOwned, options);
        
        // 返回厨师对象数组（保持原有接口兼容）
        return result.map(function(item) {
            return item.chef;
        });
    }
    
    /**
     * 获取光环厨师（Partial技法加成类）
     */
    function getAuraChefs(chefs, onlyShowOwned) {
        if (!chefs || !chefs.length) return [];
        
        var auraChefs = [];
        
        for (var i = 0; i < chefs.length; i++) {
            var chef = chefs[i];
            if (onlyShowOwned && chef.got !== "是") continue;
            
            // 检查是否有Partial技法加成技能
            var skillBonus = getEmptySkillBonus();
            var hasPartialSkill = false;
            var conditionType = null;
            var conditionValueList = null;
            
            // 检查修炼技能（使用厨师自身的修炼状态）
            if (chef.ultimate === "是") {
                if (chef.ultimateSkillEffect) {
                    for (var j = 0; j < chef.ultimateSkillEffect.length; j++) {
                        var effect = chef.ultimateSkillEffect[j];
                        if (effect.condition === 'Partial' && isSkillBonusType(effect.type)) {
                            extractSkillBonus(effect, skillBonus);
                            hasPartialSkill = true;
                            if (effect.conditionType) conditionType = effect.conditionType;
                            if (effect.conditionValueList) conditionValueList = effect.conditionValueList;
                        }
                    }
                }
            }
            
            if (hasPartialSkill) {
                auraChefs.push({
                    chef: chef,
                    skillBonus: skillBonus,
                    totalBonus: getTotalSkillBonus(skillBonus),
                    conditionType: conditionType,
                    conditionValueList: conditionValueList
                });
            }
        }
        
        // 按技法加成总值降序排序
        auraChefs.sort(function(a, b) {
            return b.totalBonus - a.totalBonus;
        });
        
        return auraChefs;
    }

    /**
     * 判断是否为技法加成类型（使用公共常量）
     */
    function isSkillBonusType(type) {
        return SKILL_EFFECT_TYPE_CHECK[type] === true;
    }
    
    /**
     * 提取技法加成值（使用公共常量）
     */
    function extractSkillBonus(effect, skillBonus) {
        var value = effect.value || 0;
        var skill = SKILL_EFFECT_MAP[effect.type];
        if (skill) {
            skillBonus[skill] += value;
        }
    }
    
    /**
     * 检查目标厨师是否满足光环厨师的技能条件
     */
    function checkAuraCondition(targetChef, auraChef) {
        if (!auraChef.conditionType || !auraChef.conditionValueList) {
            return true;
        }
        
        if (auraChef.conditionType === 'ChefTag') {
            var targetTags = targetChef.tags || [];
            for (var i = 0; i < auraChef.conditionValueList.length; i++) {
                if (targetTags.indexOf(auraChef.conditionValueList[i]) >= 0) {
                    return true;
                }
            }
            return false;
        }
        
        return true;
    }

    /**
     * 生成厨师组合（最多3个厨师一组）
     * @param {Array} chefs - 厨师列表
     * @returns {Array} 所有可能的1~3厨师组合列表
     */
    function generateChefCombinations(chefs) {
        var combinations = [];
        var n = chefs.length;

        if (n <= 0) {
            return combinations;
        }

        for (var i = 0; i < n; i++) {
            combinations.push([chefs[i]]);
        }

        for (i = 0; i < n - 1; i++) {
            for (var j = i + 1; j < n; j++) {
                combinations.push([chefs[i], chefs[j]]);
            }
        }

        for (i = 0; i < n - 2; i++) {
            for (j = i + 1; j < n - 1; j++) {
                for (var k = j + 1; k < n; k++) {
                    combinations.push([chefs[i], chefs[j], chefs[k]]);
                }
            }
        }

        return combinations;
    }
    
    /**
     * 检查厨师组合中符文技能的品级要求
     * 返回需要的最低品级（如果有品级要求的话）
     * @param {Array} group - 厨师组合
     * @returns {string} 品级值 "1"-"4"，默认"1"（可）
     */
    function getRequiredQualityLevelForGroup(group) {
        var maxRequiredRank = 0; // 0表示没有品级要求
        var hasRuneChef = false; // 是否有符文类厨师
        
        for (var c = 0; c < group.length; c++) {
            var chef = group[c];
            
            // 检查厨师技能
            if (chef.specialSkillEffect) {
                for (var i = 0; i < chef.specialSkillEffect.length; i++) {
                    var skill = chef.specialSkillEffect[i];
                    if (skill.type === 'GuestAntiqueDropRate') {
                        hasRuneChef = true;
                        if (skill.conditionType === 'Rank' && skill.conditionValue) {
                            // 有品级要求，记录最高要求
                            maxRequiredRank = Math.max(maxRequiredRank, skill.conditionValue);
                        }
                        // 如果没有conditionType或不是Rank，不需要品级要求
                    }
                }
            }
            
            // 检查修炼技能
            if (chef.ultimateSkillEffect) {
                for (var i = 0; i < chef.ultimateSkillEffect.length; i++) {
                    var skill = chef.ultimateSkillEffect[i];
                    if (skill.type === 'GuestAntiqueDropRate') {
                        hasRuneChef = true;
                        if (skill.conditionType === 'Rank' && skill.conditionValue) {
                            maxRequiredRank = Math.max(maxRequiredRank, skill.conditionValue);
                        }
                    }
                }
            }
        }
        
        // 如果有品级要求，返回对应品级
        if (maxRequiredRank > 0) {
            return String(maxRequiredRank);
        }
        // 如果有符文厨师但没有品级要求，返回"4"（神级）以获得最高符文率
        if (hasRuneChef) {
            return "4";
        }
        // 没有符文类厨师时，默认返回"1"（可级）
        return "1";
    }

    // ========================================
    // 符文菜谱查询函数
    // ========================================
    
    /**
     * 获取选中的符文列表
     */
    function getSelectedRunes() {
        var selected = [];
        if (settings.goldRuneSelections && settings.goldRuneSelections.length > 0) {
            selected = selected.concat(settings.goldRuneSelections);
        }
        if (isJadeQueryMode()) {
            return selected;
        }
        if (settings.silverRuneSelections && settings.silverRuneSelections.length > 0) {
            selected = selected.concat(settings.silverRuneSelections);
        }
        if (settings.bronzeRuneSelections && settings.bronzeRuneSelections.length > 0) {
            selected = selected.concat(settings.bronzeRuneSelections);
        }
        return selected;
    }

    /**
     * 获取选中符文对应菜谱的最高星级
     * @param {Array} selectedRunes - 选中的符文列表
     * @param {Array} recipes - 所有菜谱
     * @param {Object} gameData - 游戏数据（包含guests信息）
     * @param {boolean} onlyOwned - 只显示已拥有
     * @returns {number} 最高菜谱星级 (1-5)，默认返回5
     */
    function getHighestRecipeStarLevel(selectedRunes, recipes, gameData, onlyOwned) {
        if (!selectedRunes || selectedRunes.length === 0 || !recipes || !gameData || !gameData.guests) {
            return 5; // 默认5星
        }
        
        var highestStar = 1; // 从最低星级开始
        
        // 构建菜谱名称到菜谱对象的映射
        var recipeByName = {};
        for (var i = 0; i < recipes.length; i++) {
            var recipe = recipes[i];
            if (recipe.name) {
                recipeByName[recipe.name] = recipe;
            }
        }
        
        // 遍历贵客数据，查找选中符文对应的菜谱星级
        for (var g = 0; g < gameData.guests.length; g++) {
            var guest = gameData.guests[g];
            if (!guest.gifts) continue;
            
            for (var gf = 0; gf < guest.gifts.length; gf++) {
                var gift = guest.gifts[gf];
                if (!gift.antique) continue;
                
                // 检查是否是选中的符文
                if (selectedRunes.indexOf(gift.antique) < 0) continue;
                
                var recipe = recipeByName[gift.recipe];
                if (!recipe) continue;
                if (onlyOwned && recipe.got !== "是") continue;
                
                // 更新最高星级
                var starLevel = recipe.rarity || 5;
                if (starLevel > highestStar) {
                    highestStar = starLevel;
                }
            }
        }
        
        return highestStar;
    }

    /**
     * 计算厨师的完整技法值（含厨具加成和光环加成）
     * 使用 setDataForChef 正确计算包含百分比加成的技法值
     * @param {Object} chef - 厨师对象
     * @param {boolean} useEquip - 是否使用厨具加成（使用厨师已配厨具）
     * @param {Object} overrideEquip - 可选，指定使用的厨具（优先级高于厨师已配厨具）
     * @param {Array} partialAdds - 可选，光环厨师的修炼技能效果数组
     */
    function getChefWithFullBonus(chef, useEquip, overrideEquip, partialAdds) {
        var boosted = JSON.parse(JSON.stringify(chef));
        
        // 获取规则数据
        var rule = null;
        if (typeof calCustomRule !== 'undefined' && calCustomRule.rules && calCustomRule.rules[0]) {
            rule = calCustomRule.rules[0];
        }
        
        // 确定使用的厨具
        var equipToUse = null;
        if (overrideEquip && overrideEquip.effect) {
            equipToUse = overrideEquip;
        } else if (useEquip && chef.equip && chef.equip.effect) {
            equipToUse = chef.equip;
        }
        
        // 获取页面上的遗玉开关状态
        var useAmber = $('#chk-cal-use-amber').is(':checked');
        
        // 使用 setDataForChef 计算技法值（包含厨具百分比加成和光环加成）
        if (rule && typeof setDataForChef === 'function') {
            setDataForChef(
                boosted,
                equipToUse,
                true,
                rule.calGlobalUltimateData,
                partialAdds || null, // 光环加成
                rule.calSelfUltimateData,
                rule.calActivityUltimateData,
                true,
                rule,
                useAmber,
                rule.calQixiaData || null
            );
        }
        
        return boosted;
    }

    function isJadeQueryMode() {
        return $("#chk-guest-rate-submode").prop("checked") === true;
    }

    function buildRecipeByNameMap(recipes) {
        var recipeByName = {};
        for (var i = 0; i < recipes.length; i++) {
            var recipe = recipes[i];
            if (recipe && recipe.name) {
                recipeByName[recipe.name] = recipe;
            }
        }
        return recipeByName;
    }

    function buildEnhancedChefsForGroup(finalChefs, useExistingChefs, existingPositions, pageEquipsByPosition, useEquip) {
        var onFieldAuraChefs = [];
        var enhancedChefs = [];
        var i, j, a, e;

        for (i = 0; i < finalChefs.length; i++) {
            var chef = finalChefs[i];
            var skillBonus = getEmptySkillBonus();
            var hasPartialSkill = false;
            var conditionType = null;
            var conditionValueList = null;

            if (chef.ultimate === "是" && chef.ultimateSkillEffect) {
                for (j = 0; j < chef.ultimateSkillEffect.length; j++) {
                    var effect = chef.ultimateSkillEffect[j];
                    if (effect.condition === 'Partial' && isSkillBonusType(effect.type)) {
                        extractSkillBonus(effect, skillBonus);
                        hasPartialSkill = true;
                        if (effect.conditionType) conditionType = effect.conditionType;
                        if (effect.conditionValueList) conditionValueList = effect.conditionValueList;
                    }
                }
            }

            if (hasPartialSkill) {
                onFieldAuraChefs.push({
                    chef: chef,
                    chefIndex: i,
                    skillBonus: skillBonus,
                    conditionType: conditionType,
                    conditionValueList: conditionValueList
                });
            }
        }

        for (i = 0; i < finalChefs.length; i++) {
            var currentChef = finalChefs[i];
            var originalPosition = useExistingChefs ? existingPositions[i] : i;
            var pageEquipForPosition = pageEquipsByPosition[originalPosition] || null;
            var partialAdds = [];
            var auraBonus = getEmptySkillBonus();

            for (a = 0; a < onFieldAuraChefs.length; a++) {
                var auraChef = onFieldAuraChefs[a];
                if (auraChef.chefIndex === i) {
                    continue;
                }
                if (!checkAuraCondition(currentChef, auraChef)) {
                    continue;
                }

                if (auraChef.chef.ultimateSkillEffect) {
                    for (e = 0; e < auraChef.chef.ultimateSkillEffect.length; e++) {
                        var auraEffect = auraChef.chef.ultimateSkillEffect[e];
                        if (auraEffect.condition === 'Partial' && isSkillBonusType(auraEffect.type)) {
                            partialAdds.push(auraEffect);
                        }
                    }
                }
                auraBonus = combineSkillBonus(auraBonus, auraChef.skillBonus);
            }

            var boostedChef;
            if (pageEquipForPosition) {
                boostedChef = getChefWithFullBonus(currentChef, false, pageEquipForPosition, partialAdds);
            } else {
                boostedChef = getChefWithFullBonus(currentChef, useEquip, null, partialAdds);
            }

            enhancedChefs.push({
                original: currentChef,
                enhanced: boostedChef,
                auraBonus: auraBonus,
                recipes: [],
                originalPosition: originalPosition
            });
        }

        return enhancedChefs;
    }

    function getEligibleChefAssignmentsForRecipe(recipe, enhancedChefs) {
        var assignments = [];

        for (var c = 0; c < enhancedChefs.length; c++) {
            var enhancedChef = enhancedChefs[c].enhanced;
            var rank = getRecipeRank(enhancedChef, recipe);
            if (rank === 0) {
                continue;
            }

            if (hasDivineRecipeSkill(enhancedChef) && rank < 4) {
                continue;
            }

            assignments.push({
                chefIndex: c,
                rank: rank
            });
        }

        assignments.sort(function(a, b) {
            if (a.rank !== b.rank) {
                return a.rank - b.rank;
            }
            return a.chefIndex - b.chefIndex;
        });

        return assignments;
    }

    function buildJadeRecipeBaseData(selectedRunes, recipes, gameData, onlyShowOwned) {
        var recipeByName = buildRecipeByNameMap(recipes);
        var allRuneRecipes = [];
        var recipeToRunesMap = {};
        var recipesByGuest = {};
        var noConflictRecipes = {};
        var conflictRecipes = {};
        var conflictInfo = {};
        var baseCandidateMap = {};
        var baseCandidates = [];
        var availableRunesMap = {};
        var r, g, gf, i;

        for (r = 0; r < selectedRunes.length; r++) {
            var rune = selectedRunes[r];

            for (g = 0; g < gameData.guests.length; g++) {
                var guest = gameData.guests[g];
                if (!guest.gifts) {
                    continue;
                }

                for (gf = 0; gf < guest.gifts.length; gf++) {
                    var gift = guest.gifts[gf];
                    if (gift.antique !== rune) {
                        continue;
                    }

                    var recipe = recipeByName[gift.recipe];
                    if (!recipe) {
                        continue;
                    }
                    if (onlyShowOwned && recipe.got !== "是") {
                        continue;
                    }

                    if (!recipeToRunesMap[recipe.name]) {
                        recipeToRunesMap[recipe.name] = [];
                        allRuneRecipes.push(recipe);
                    }
                    if (recipeToRunesMap[recipe.name].indexOf(rune) === -1) {
                        recipeToRunesMap[recipe.name].push(rune);
                    }
                }
            }
        }

        for (i = 0; i < allRuneRecipes.length; i++) {
            var currentRecipe = allRuneRecipes[i];

            for (g = 0; g < gameData.guests.length; g++) {
                var guestForGroup = gameData.guests[g];
                if (!guestForGroup.gifts) {
                    continue;
                }

                var hasRecipeForSelectedRunes = false;
                for (gf = 0; gf < guestForGroup.gifts.length; gf++) {
                    var guestGift = guestForGroup.gifts[gf];
                    if (guestGift.recipe === currentRecipe.name && selectedRunes.indexOf(guestGift.antique) >= 0) {
                        hasRecipeForSelectedRunes = true;
                        break;
                    }
                }

                if (!hasRecipeForSelectedRunes) {
                    continue;
                }

                if (!recipesByGuest[guestForGroup.name]) {
                    recipesByGuest[guestForGroup.name] = [];
                }

                var alreadyAdded = false;
                for (var rg = 0; rg < recipesByGuest[guestForGroup.name].length; rg++) {
                    if (recipesByGuest[guestForGroup.name][rg].recipeId === currentRecipe.recipeId) {
                        alreadyAdded = true;
                        break;
                    }
                }
                if (!alreadyAdded) {
                    recipesByGuest[guestForGroup.name].push(currentRecipe);
                }
            }
        }

        for (var guestName in recipesByGuest) {
            var guestRecipes = recipesByGuest[guestName];

            if (guestRecipes.length === 1) {
                noConflictRecipes[guestRecipes[0].recipeId] = true;
                continue;
            }

            var recipesWithAdjustedTime = [];
            for (i = 0; i < guestRecipes.length; i++) {
                var guestRecipe = guestRecipes[i];
                var guestCount = getRecipeGuestCount(guestRecipe, gameData);
                recipesWithAdjustedTime.push({
                    recipe: guestRecipe,
                    adjustedTime: (guestCount >= 2) ? (guestRecipe.time / 2) : guestRecipe.time
                });
            }

            recipesWithAdjustedTime.sort(function(a, b) {
                return a.adjustedTime - b.adjustedTime;
            });

            noConflictRecipes[recipesWithAdjustedTime[0].recipe.recipeId] = true;

            for (i = 1; i < recipesWithAdjustedTime.length; i++) {
                var conflictRecipe = recipesWithAdjustedTime[i].recipe;
                conflictRecipes[conflictRecipe.recipeId] = true;
                conflictInfo[conflictRecipe.recipeId] = {
                    guestName: guestName,
                    conflictWith: recipesWithAdjustedTime[0].recipe.name
                };
            }
        }

        for (r = 0; r < selectedRunes.length; r++) {
            var selectedRune = selectedRunes[r];

            for (g = 0; g < gameData.guests.length; g++) {
                var guestItem = gameData.guests[g];
                if (!guestItem.gifts) {
                    continue;
                }

                for (gf = 0; gf < guestItem.gifts.length; gf++) {
                    var giftItem = guestItem.gifts[gf];
                    if (giftItem.antique !== selectedRune) {
                        continue;
                    }

                    var matchedRecipe = recipeByName[giftItem.recipe];
                    if (!matchedRecipe) {
                        continue;
                    }
                    if (onlyShowOwned && matchedRecipe.got !== "是") {
                        continue;
                    }
                    if (conflictRecipes[matchedRecipe.recipeId]) {
                        continue;
                    }

                    var candidate = baseCandidateMap[matchedRecipe.recipeId];
                    if (!candidate) {
                        candidate = {
                            recipe: matchedRecipe,
                            runeOptions: []
                        };
                        baseCandidateMap[matchedRecipe.recipeId] = candidate;
                        baseCandidates.push(candidate);
                    }

                    if (candidate.runeOptions.indexOf(selectedRune) === -1) {
                        candidate.runeOptions.push(selectedRune);
                    }
                    availableRunesMap[selectedRune] = true;
                }
            }
        }

        var availableRunes = [];
        for (r = 0; r < selectedRunes.length; r++) {
            if (availableRunesMap[selectedRunes[r]]) {
                availableRunes.push(selectedRunes[r]);
            }
        }

        return {
            baseCandidates: baseCandidates,
            availableRunes: availableRunes,
            conflictInfo: conflictInfo,
            conflictCount: Object.keys(conflictRecipes).length
        };
    }

    function buildJadeRecipeCandidatesForGroup(baseCandidates, enhancedChefs) {
        var candidates = [];
        var cannotMakeInfo = {};

        for (var i = 0; i < baseCandidates.length; i++) {
            var baseCandidate = baseCandidates[i];
            var eligibleAssignments = getEligibleChefAssignmentsForRecipe(baseCandidate.recipe, enhancedChefs);

            if (!eligibleAssignments.length) {
                cannotMakeInfo[baseCandidate.recipe.recipeId] = baseCandidate.recipe.name;
                continue;
            }

            candidates.push({
                recipe: baseCandidate.recipe,
                runeOptions: baseCandidate.runeOptions.slice(),
                eligibleAssignments: eligibleAssignments
            });
        }

        return {
            candidates: candidates,
            cannotMakeInfo: cannotMakeInfo,
            cannotMakeCount: Object.keys(cannotMakeInfo).length
        };
    }

    function getJadeAvailableRunesFromCandidates(candidates, preferredRunes) {
        var runeMap = {};
        var availableRunes = [];
        var i;
        var j;
        var rune;

        preferredRunes = Array.isArray(preferredRunes) ? preferredRunes : [];

        for (i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            if (!candidate || !candidate.runeOptions) {
                continue;
            }
            for (j = 0; j < candidate.runeOptions.length; j++) {
                rune = candidate.runeOptions[j];
                if (rune) {
                    runeMap[rune] = true;
                }
            }
        }

        for (i = 0; i < preferredRunes.length; i++) {
            rune = preferredRunes[i];
            if (runeMap[rune]) {
                availableRunes.push(rune);
                delete runeMap[rune];
            }
        }

        for (rune in runeMap) {
            if (runeMap.hasOwnProperty(rune)) {
                availableRunes.push(rune);
            }
        }

        return availableRunes;
    }

    function encodeChefLoadCode(load0, load1, load2) {
        return load0 + load1 * 4 + load2 * 16;
    }

    function decodeChefLoadCode(code) {
        return [
            code % 4,
            Math.floor(code / 4) % 4,
            Math.floor(code / 16) % 4
        ];
    }

    function shouldReplaceJadeState(currentState, score, valueSum, timeSum, rankSum) {
        var EPS = 1e-9;
        if (!currentState) {
            return true;
        }
        if (score > currentState.score + EPS) {
            return true;
        }
        if (Math.abs(score - currentState.score) > EPS) {
            return false;
        }
        if (rankSum < currentState.rankSum) {
            return true;
        }
        if (rankSum > currentState.rankSum) {
            return false;
        }

        var currentRatio = currentState.timeSum > 0 ? currentState.valueSum / currentState.timeSum : 0;
        var nextRatio = timeSum > 0 ? valueSum / timeSum : 0;
        if (nextRatio > currentRatio + EPS) {
            return true;
        }
        if (Math.abs(nextRatio - currentRatio) > EPS) {
            return false;
        }
        if (valueSum > currentState.valueSum + EPS) {
            return true;
        }
        if (Math.abs(valueSum - currentState.valueSum) <= EPS && timeSum < currentState.timeSum - EPS) {
            return true;
        }
        return false;
    }

    function prepareJadeCandidates(candidates, requiredRunes, totalGuestRate, totalTimeBonus) {
        var requiredBitByRune = {};
        var requiredRuneByBit = {};
        var nextBit = 1;
        var preparedCandidates = [];

        for (var i = 0; i < requiredRunes.length; i++) {
            requiredBitByRune[requiredRunes[i]] = nextBit;
            requiredRuneByBit[nextBit] = requiredRunes[i];
            nextBit *= 2;
        }

        for (i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            var quantityResult = calculateRecipeQuantity(candidate.recipe, totalGuestRate, false);
            var quantityForTime = quantityResult.canAchieveBilai ? quantityResult.quantity : quantityResult.maxQuantity;
            var cookingTime = calculateCookingTime(candidate.recipe.time || 0, quantityForTime, totalTimeBonus);
            var requiredBits = [];

            for (var r = 0; r < candidate.runeOptions.length; r++) {
                var bit = requiredBitByRune[candidate.runeOptions[r]];
                if (bit && requiredBits.indexOf(bit) === -1) {
                    requiredBits.push(bit);
                }
            }

            preparedCandidates.push({
                recipe: candidate.recipe,
                runeOptions: candidate.runeOptions.slice(),
                eligibleAssignments: candidate.eligibleAssignments,
                jadeValue: getJadeRecipeValue(candidate.recipe.name),
                quantity: quantityResult.quantity,
                quantityForTime: quantityForTime,
                canAchieveBilai: quantityResult.canAchieveBilai,
                requiredPortions: quantityResult.requiredPortions,
                maxQuantity: quantityResult.maxQuantity,
                cookingTime: cookingTime,
                requiredBits: requiredBits
            });
        }

        return {
            preparedCandidates: preparedCandidates,
            requiredMask: nextBit - 1,
            requiredRuneByBit: requiredRuneByBit
        };
    }

    function getJadeCandidateBestRank(candidate) {
        if (!candidate || !candidate.eligibleAssignments || !candidate.eligibleAssignments.length) {
            return 99;
        }
        return candidate.eligibleAssignments[0].rank || 99;
    }

    function getJadeCandidateEfficiency(candidate) {
        if (!candidate || !candidate.cookingTime || candidate.cookingTime <= 0) {
            return 0;
        }
        return candidate.jadeValue / candidate.cookingTime;
    }

    function compareJadeCandidatePriority(a, b) {
        var efficiencyDiff = getJadeCandidateEfficiency(b) - getJadeCandidateEfficiency(a);
        if (Math.abs(efficiencyDiff) > 1e-12) {
            return efficiencyDiff;
        }

        var rankDiff = getJadeCandidateBestRank(a) - getJadeCandidateBestRank(b);
        if (rankDiff !== 0) {
            return rankDiff;
        }

        var jadeDiff = (b.jadeValue || 0) - (a.jadeValue || 0);
        if (jadeDiff !== 0) {
            return jadeDiff;
        }

        var timeDiff = (a.cookingTime || 0) - (b.cookingTime || 0);
        if (timeDiff !== 0) {
            return timeDiff;
        }

        return String(a.recipe && a.recipe.name || '').localeCompare(String(b.recipe && b.recipe.name || ''));
    }

    function getBestAvailableChefAssignment(candidate, chefLoads) {
        if (!candidate || !candidate.eligibleAssignments) {
            return null;
        }

        for (var i = 0; i < candidate.eligibleAssignments.length; i++) {
            var assignment = candidate.eligibleAssignments[i];
            if ((chefLoads[assignment.chefIndex] || 0) < 3) {
                return assignment;
            }
        }

        return null;
    }

    function buildJadeRuneCandidateBuckets(preparedCandidates, requiredRunes) {
        var buckets = {};

        for (var i = 0; i < requiredRunes.length; i++) {
            buckets[requiredRunes[i]] = [];
        }

        for (i = 0; i < preparedCandidates.length; i++) {
            var candidate = preparedCandidates[i];
            for (var r = 0; r < candidate.runeOptions.length; r++) {
                var rune = candidate.runeOptions[r];
                if (buckets[rune]) {
                    buckets[rune].push(candidate);
                }
            }
        }

        for (i = 0; i < requiredRunes.length; i++) {
            buckets[requiredRunes[i]].sort(compareJadeCandidatePriority);
        }

        return buckets;
    }

    function pickNextJadeCandidateForRune(rune, runeBuckets, usedRecipeIds, chefLoads) {
        var bucket = runeBuckets[rune] || [];

        for (var i = 0; i < bucket.length; i++) {
            var candidate = bucket[i];
            var recipeId = candidate.recipe && candidate.recipe.recipeId;
            if (!recipeId || usedRecipeIds[recipeId]) {
                continue;
            }

            var assignment = getBestAvailableChefAssignment(candidate, chefLoads);
            if (!assignment) {
                continue;
            }

            return {
                candidate: candidate,
                assignment: assignment
            };
        }

        return null;
    }

    function getPerRankGuestDropCountRequirement(chef) {
        if (!chef) {
            return 0;
        }

        var requiredRank = 0;
        var effectLists = [];

        if (chef.specialSkillEffect && chef.specialSkillEffect.length) {
            effectLists.push(chef.specialSkillEffect);
        }
        if (chef.ultimate === "是" && chef.ultimateSkillEffect && chef.ultimateSkillEffect.length) {
            effectLists.push(chef.ultimateSkillEffect);
        }

        for (var i = 0; i < effectLists.length; i++) {
            var effects = effectLists[i];
            for (var j = 0; j < effects.length; j++) {
                var effect = effects[j];
                if (!effect || effect.type !== 'GuestDropCount' || effect.conditionType !== 'PerRank') {
                    continue;
                }
                requiredRank = Math.max(requiredRank, Number(effect.conditionValue) || 4);
            }
        }

        return requiredRank;
    }

    function buildPerRankChefRequirementMap(enhancedChefs) {
        var requirementMap = {};

        for (var i = 0; i < enhancedChefs.length; i++) {
            var requiredRank = getPerRankGuestDropCountRequirement(enhancedChefs[i] && enhancedChefs[i].original);
            if (requiredRank > 0) {
                requirementMap[i] = requiredRank;
            }
        }

        return requirementMap;
    }

    function optimizeFixedJadeAssignments(selectedEntries, perRankChefRequirementMap) {
        if (!selectedEntries || !selectedEntries.length) {
            return [];
        }

        perRankChefRequirementMap = perRankChefRequirementMap || {};

        var orderedEntries = selectedEntries.map(function(entry, index) {
            return {
                entry: entry,
                originalIndex: index
            };
        });

        orderedEntries.sort(function(a, b) {
            var assignmentCountDiff = (a.entry.candidate.eligibleAssignments.length || 0) - (b.entry.candidate.eligibleAssignments.length || 0);
            if (assignmentCountDiff !== 0) {
                return assignmentCountDiff;
            }
            return compareJadeCandidatePriority(a.entry.candidate, b.entry.candidate);
        });

        var memo = {};

        function dfs(position, loadCode) {
            if (position >= orderedEntries.length) {
                return {
                    qualifyingCount: 0,
                    nonPriorityRankSum: 0,
                    rankSum: 0,
                    next: null
                };
            }

            var memoKey = position + ':' + loadCode;
            if (memo[memoKey]) {
                return memo[memoKey];
            }

            var loads = decodeChefLoadCode(loadCode);
            var candidate = orderedEntries[position].entry.candidate;
            var best = null;

            for (var i = 0; i < candidate.eligibleAssignments.length; i++) {
                var assignment = candidate.eligibleAssignments[i];
                if (loads[assignment.chefIndex] >= 3) {
                    continue;
                }

                var nextLoads = loads.slice();
                nextLoads[assignment.chefIndex]++;
                var nextLoadCode = encodeChefLoadCode(nextLoads[0], nextLoads[1], nextLoads[2]);
                var nextResult = dfs(position + 1, nextLoadCode);
                if (!nextResult) {
                    continue;
                }

                var priorityRequiredRank = perRankChefRequirementMap[assignment.chefIndex] || 0;
                var qualifyingCount = nextResult.qualifyingCount + (priorityRequiredRank > 0 && assignment.rank >= priorityRequiredRank ? 1 : 0);
                var nonPriorityRankSum = nextResult.nonPriorityRankSum + (priorityRequiredRank > 0 ? 0 : assignment.rank);
                var totalRankSum = assignment.rank + nextResult.rankSum;
                if (!best ||
                    qualifyingCount > best.qualifyingCount ||
                    (qualifyingCount === best.qualifyingCount && nonPriorityRankSum < best.nonPriorityRankSum) ||
                    (qualifyingCount === best.qualifyingCount && nonPriorityRankSum === best.nonPriorityRankSum && totalRankSum < best.rankSum) ||
                    (qualifyingCount === best.qualifyingCount && nonPriorityRankSum === best.nonPriorityRankSum && totalRankSum === best.rankSum && assignment.chefIndex < best.assignment.chefIndex)) {
                    best = {
                        qualifyingCount: qualifyingCount,
                        nonPriorityRankSum: nonPriorityRankSum,
                        rankSum: totalRankSum,
                        assignment: assignment,
                        nextLoadCode: nextLoadCode,
                        next: nextResult
                    };
                }
            }

            memo[memoKey] = best;
            return best;
        }

        var solved = dfs(0, encodeChefLoadCode(0, 0, 0));
        if (!solved) {
            return null;
        }

        var results = new Array(selectedEntries.length);
        var currentLoadCode = encodeChefLoadCode(0, 0, 0);

        for (var pos = 0; pos < orderedEntries.length; pos++) {
            var current = memo[pos + ':' + currentLoadCode];
            if (!current || !current.assignment) {
                return null;
            }

            results[orderedEntries[pos].originalIndex] = {
                chefIndex: current.assignment.chefIndex,
                rank: current.assignment.rank
            };
            currentLoadCode = current.nextLoadCode;
        }

        return results;
    }

    function findFastestQualifyingSupplementRecipe(allRecipes, enhancedChef, requiredRank, usedRecipeIds, onlyShowOwned) {
        if (!allRecipes || !enhancedChef || requiredRank <= 0) {
            return null;
        }

        var bestRecipe = null;
        var bestRank = 0;

        for (var i = 0; i < allRecipes.length; i++) {
            var recipe = allRecipes[i];
            if (!recipe || !recipe.recipeId) {
                continue;
            }
            if (usedRecipeIds[recipe.recipeId]) {
                continue;
            }
            if (onlyShowOwned && recipe.got !== "是") {
                continue;
            }

            var rank = getRecipeRank(enhancedChef, recipe);
            if (rank < requiredRank) {
                continue;
            }
            if (hasDivineRecipeSkill(enhancedChef) && rank < 4) {
                continue;
            }

            if (!bestRecipe || (recipe.time || 0) < (bestRecipe.time || 0) ||
                ((recipe.time || 0) === (bestRecipe.time || 0) && rank < bestRank)) {
                bestRecipe = recipe;
                bestRank = rank;
            }
        }

        if (!bestRecipe) {
            return null;
        }

        return {
            recipe: bestRecipe,
            rank: bestRank
        };
    }

    function supplementPerRankChefSelections(selections, enhancedChefs, allRecipes, onlyShowOwned, totalGuestRate, totalTimeBonus) {
        if (!selections || !selections.length || !enhancedChefs || !enhancedChefs.length) {
            return selections || [];
        }

        var requirementMap = buildPerRankChefRequirementMap(enhancedChefs);
        var chefRecipeCounts = [0, 0, 0];
        var usedRecipeIds = {};

        for (var i = 0; i < selections.length; i++) {
            var selection = selections[i];
            usedRecipeIds[selection.recipe.recipeId] = true;
            chefRecipeCounts[selection.chefIndex] = (chefRecipeCounts[selection.chefIndex] || 0) + 1;
        }

        for (var chefIndex in requirementMap) {
            if (!requirementMap.hasOwnProperty(chefIndex)) {
                continue;
            }
            var numericChefIndex = Number(chefIndex);
            var requiredRank = requirementMap[chefIndex];

            while ((chefRecipeCounts[numericChefIndex] || 0) < 3) {
                var supplement = findFastestQualifyingSupplementRecipe(
                    allRecipes,
                    enhancedChefs[numericChefIndex].enhanced,
                    requiredRank,
                    usedRecipeIds,
                    onlyShowOwned
                );
                if (!supplement) {
                    break;
                }

                selections.push({
                    recipe: supplement.recipe,
                    chefIndex: numericChefIndex,
                    rank: supplement.rank,
                    rune: null,
                    quantity: 1,
                    quantityForTime: 1,
                    cookingTime: calculateCookingTime(supplement.recipe.time || 0, 1, totalTimeBonus),
                    canAchieveBilai: true,
                    requiredPortions: 1,
                    maxQuantity: 1,
                    jadeValue: getJadeRecipeValue(supplement.recipe.name),
                    runeOptions: [],
                    isFullPoolSupplement: true
                });
                usedRecipeIds[supplement.recipe.recipeId] = true;
                chefRecipeCounts[numericChefIndex] = (chefRecipeCounts[numericChefIndex] || 0) + 1;
            }
        }

        return selections;
    }

    function supplementPerRankChefRecipesInPlace(enhancedChefs, allRecipes, onlyShowOwned) {
        if (!enhancedChefs || !enhancedChefs.length) {
            return;
        }

        var requirementMap = buildPerRankChefRequirementMap(enhancedChefs);
        var usedRecipeIds = {};

        for (var i = 0; i < enhancedChefs.length; i++) {
            var currentRecipes = enhancedChefs[i].recipes || [];
            for (var j = 0; j < currentRecipes.length; j++) {
                if (currentRecipes[j] && currentRecipes[j].recipe && currentRecipes[j].recipe.recipeId) {
                    usedRecipeIds[currentRecipes[j].recipe.recipeId] = true;
                }
            }
        }

        for (var chefIndexKey in requirementMap) {
            if (!requirementMap.hasOwnProperty(chefIndexKey)) {
                continue;
            }
            var chefIndex = Number(chefIndexKey);
            var chefData = enhancedChefs[chefIndex];
            if (!chefData) {
                continue;
            }

            while ((chefData.recipes || []).length < 3) {
                var supplement = findFastestQualifyingSupplementRecipe(
                    allRecipes,
                    chefData.enhanced,
                    requirementMap[chefIndexKey],
                    usedRecipeIds,
                    onlyShowOwned
                );
                if (!supplement) {
                    break;
                }

                chefData.recipes.push({
                    recipe: supplement.recipe,
                    rank: supplement.rank,
                    rune: null,
                    isFullPoolSupplement: true
                });
                usedRecipeIds[supplement.recipe.recipeId] = true;
            }
        }
    }

    function getSelectionJadeEfficiency(selection) {
        if (!selection || !selection.cookingTime) {
            return 0;
        }
        return (selection.jadeValue || 0) / selection.cookingTime;
    }

    function rebalancePerRankSelectionsToOtherChefs(selections, enhancedChefs, perRankChefRequirementMap) {
        if (!selections || !selections.length || !enhancedChefs || !enhancedChefs.length) {
            return selections || [];
        }

        perRankChefRequirementMap = perRankChefRequirementMap || {};
        var usageState = rebuildJadeSelectionUsage(selections);
        var targetChefIndexes = [];

        for (var chefIndex = 0; chefIndex < enhancedChefs.length; chefIndex++) {
            if (!perRankChefRequirementMap.hasOwnProperty(String(chefIndex)) && !perRankChefRequirementMap.hasOwnProperty(chefIndex)) {
                targetChefIndexes.push(chefIndex);
            }
        }

        if (!targetChefIndexes.length) {
            return selections;
        }

        var moveCandidates = selections
            .map(function(selection, index) {
                return {
                    selection: selection,
                    index: index
                };
            })
            .filter(function(item) {
                return perRankChefRequirementMap.hasOwnProperty(String(item.selection.chefIndex)) ||
                    perRankChefRequirementMap.hasOwnProperty(item.selection.chefIndex);
            });

        moveCandidates.sort(function(a, b) {
            var efficiencyDiff = getSelectionJadeEfficiency(b.selection) - getSelectionJadeEfficiency(a.selection);
            if (Math.abs(efficiencyDiff) > 1e-12) {
                return efficiencyDiff;
            }
            return (a.selection.cookingTime || 0) - (b.selection.cookingTime || 0);
        });

        function findMoveTarget(recipe, currentChefIndex) {
            var bestTarget = null;

            for (var i = 0; i < targetChefIndexes.length; i++) {
                var targetChefIndex = targetChefIndexes[i];
                if (targetChefIndex === currentChefIndex) {
                    continue;
                }
                if ((usageState.chefLoads[targetChefIndex] || 0) >= 3) {
                    continue;
                }

                var enhancedChef = enhancedChefs[targetChefIndex] && enhancedChefs[targetChefIndex].enhanced;
                var rank = getRecipeRank(enhancedChef, recipe);
                if (rank <= 0) {
                    continue;
                }
                if (hasDivineRecipeSkill(enhancedChef) && rank < 4) {
                    continue;
                }

                if (!bestTarget ||
                    (usageState.chefLoads[targetChefIndex] || 0) < (usageState.chefLoads[bestTarget.chefIndex] || 0) ||
                    ((usageState.chefLoads[targetChefIndex] || 0) === (usageState.chefLoads[bestTarget.chefIndex] || 0) && rank < bestTarget.rank) ||
                    ((usageState.chefLoads[targetChefIndex] || 0) === (usageState.chefLoads[bestTarget.chefIndex] || 0) && rank === bestTarget.rank && targetChefIndex < bestTarget.chefIndex)) {
                    bestTarget = {
                        chefIndex: targetChefIndex,
                        rank: rank
                    };
                }
            }

            return bestTarget;
        }

        for (var mc = 0; mc < moveCandidates.length; mc++) {
            var item = moveCandidates[mc];
            var currentSelection = selections[item.index];
            var moveTarget = findMoveTarget(currentSelection.recipe, currentSelection.chefIndex);
            if (!moveTarget) {
                continue;
            }

            usageState.chefLoads[currentSelection.chefIndex] = Math.max(0, (usageState.chefLoads[currentSelection.chefIndex] || 0) - 1);
            usageState.chefLoads[moveTarget.chefIndex] = (usageState.chefLoads[moveTarget.chefIndex] || 0) + 1;
            currentSelection.chefIndex = moveTarget.chefIndex;
            currentSelection.rank = moveTarget.rank;

            var allTargetsFull = true;
            for (var tc = 0; tc < targetChefIndexes.length; tc++) {
                if ((usageState.chefLoads[targetChefIndexes[tc]] || 0) < 3) {
                    allTargetsFull = false;
                    break;
                }
            }
            if (allTargetsFull) {
                break;
            }
        }

        return selections;
    }

    function rebuildJadeSelectionUsage(selections) {
        var chefLoads = [0, 0, 0];
        var usedRecipeIds = {};
        var totalTimeSum = 0;
        var totalValueSum = 0;

        for (var i = 0; i < selections.length; i++) {
            var selection = selections[i];
            if (selection.recipe && selection.recipe.recipeId) {
                usedRecipeIds[selection.recipe.recipeId] = true;
            }
            chefLoads[selection.chefIndex] = (chefLoads[selection.chefIndex] || 0) + 1;
            totalTimeSum += selection.cookingTime || 0;
            totalValueSum += selection.jadeValue || 0;
        }

        return {
            chefLoads: chefLoads,
            usedRecipeIds: usedRecipeIds,
            totalTimeSum: totalTimeSum,
            totalValueSum: totalValueSum
        };
    }

    function pickBestPreparedCandidateForChef(preparedCandidates, chefIndex, minRank, usedRecipeIds, chefLoads) {
        var best = null;

        for (var i = 0; i < preparedCandidates.length; i++) {
            var candidate = preparedCandidates[i];
            var recipeId = candidate.recipe && candidate.recipe.recipeId;
            if (!recipeId || usedRecipeIds[recipeId]) {
                continue;
            }
            if ((chefLoads[chefIndex] || 0) >= 3) {
                continue;
            }

            var matchedAssignment = null;
            for (var j = 0; j < candidate.eligibleAssignments.length; j++) {
                var assignment = candidate.eligibleAssignments[j];
                if (assignment.chefIndex === chefIndex && assignment.rank >= minRank) {
                    matchedAssignment = assignment;
                    break;
                }
            }

            if (!matchedAssignment) {
                continue;
            }

            if (!best || compareJadeCandidatePriority(candidate, best.candidate) < 0) {
                best = {
                    candidate: candidate,
                    assignment: matchedAssignment
                };
            }
        }

        return best;
    }

    function pickBestPreparedCandidateGlobal(preparedCandidates, usedRecipeIds, chefLoads) {
        var best = null;

        for (var i = 0; i < preparedCandidates.length; i++) {
            var candidate = preparedCandidates[i];
            var recipeId = candidate.recipe && candidate.recipe.recipeId;
            if (!recipeId || usedRecipeIds[recipeId]) {
                continue;
            }

            var assignment = getBestAvailableChefAssignment(candidate, chefLoads);
            if (!assignment) {
                continue;
            }

            if (!best || compareJadeCandidatePriority(candidate, best.candidate) < 0) {
                best = {
                    candidate: candidate,
                    assignment: assignment
                };
            }
        }

        return best;
    }

    function supplementSelectionsWithPreparedCandidate(selections, pickResult, rune, usageState) {
        if (!pickResult || !pickResult.candidate || !pickResult.assignment) {
            return false;
        }

        selections.push({
            recipe: pickResult.candidate.recipe,
            chefIndex: pickResult.assignment.chefIndex,
            rank: pickResult.assignment.rank,
            rune: rune || null,
            quantity: pickResult.candidate.quantity,
            quantityForTime: pickResult.candidate.quantityForTime,
            cookingTime: pickResult.candidate.cookingTime,
            canAchieveBilai: pickResult.candidate.canAchieveBilai,
            requiredPortions: pickResult.candidate.requiredPortions,
            maxQuantity: pickResult.candidate.maxQuantity,
            jadeValue: pickResult.candidate.jadeValue,
            runeOptions: pickResult.candidate.runeOptions.slice()
        });

        usageState.usedRecipeIds[pickResult.candidate.recipe.recipeId] = true;
        usageState.chefLoads[pickResult.assignment.chefIndex] = (usageState.chefLoads[pickResult.assignment.chefIndex] || 0) + 1;
        usageState.totalTimeSum += pickResult.candidate.cookingTime || 0;
        usageState.totalValueSum += pickResult.candidate.jadeValue || 0;
        return true;
    }

    function solveJadeCombinationForLambda(preparedCandidates, requiredMask, lambda) {
        var stateSize = 64 * 64;
        var states = new Array(stateSize);
        states[0] = {
            score: 0,
            valueSum: 0,
            timeSum: 0,
            rankSum: 0,
            prevState: null,
            action: null
        };

        for (var i = 0; i < preparedCandidates.length; i++) {
            var candidate = preparedCandidates[i];
            var nextStates = states.slice();
            var candidateScore = candidate.jadeValue - lambda * candidate.cookingTime;

            for (var stateIndex = 0; stateIndex < states.length; stateIndex++) {
                var state = states[stateIndex];
                if (!state) {
                    continue;
                }

                var coverageMask = Math.floor(stateIndex / 64);
                var loadCode = stateIndex % 64;
                var loads = decodeChefLoadCode(loadCode);

                for (var ea = 0; ea < candidate.eligibleAssignments.length; ea++) {
                    var assignment = candidate.eligibleAssignments[ea];
                    if (loads[assignment.chefIndex] >= 3) {
                        continue;
                    }

                    var nextLoad0 = loads[0];
                    var nextLoad1 = loads[1];
                    var nextLoad2 = loads[2];
                    if (assignment.chefIndex === 0) nextLoad0++;
                    else if (assignment.chefIndex === 1) nextLoad1++;
                    else nextLoad2++;

                    var nextLoadCode = encodeChefLoadCode(nextLoad0, nextLoad1, nextLoad2);
                    var coverChoices = [0];
                    for (var rb = 0; rb < candidate.requiredBits.length; rb++) {
                        var coverBit = candidate.requiredBits[rb];
                        if ((coverageMask & coverBit) === 0) {
                            coverChoices.push(coverBit);
                        }
                    }

                    for (var cc = 0; cc < coverChoices.length; cc++) {
                        var selectedCoverBit = coverChoices[cc];
                        var nextCoverageMask = coverageMask | selectedCoverBit;
                        var nextStateIndex = nextCoverageMask * 64 + nextLoadCode;
                        var nextScore = state.score + candidateScore;
                        var nextValueSum = state.valueSum + candidate.jadeValue;
                        var nextTimeSum = state.timeSum + candidate.cookingTime;
                        var nextRankSum = state.rankSum + assignment.rank;

                        if (!shouldReplaceJadeState(nextStates[nextStateIndex], nextScore, nextValueSum, nextTimeSum, nextRankSum)) {
                            continue;
                        }

                        nextStates[nextStateIndex] = {
                            score: nextScore,
                            valueSum: nextValueSum,
                            timeSum: nextTimeSum,
                            rankSum: nextRankSum,
                            prevState: state,
                            action: {
                                candidateIndex: i,
                                chefIndex: assignment.chefIndex,
                                rank: assignment.rank,
                                coverBit: selectedCoverBit
                            }
                        };
                    }
                }
            }

            states = nextStates;
        }

        var bestState = null;
        for (var loadIndex = 0; loadIndex < 64; loadIndex++) {
            var finalState = states[requiredMask * 64 + loadIndex];
            if (!finalState) {
                continue;
            }
            if (shouldReplaceJadeState(bestState, finalState.score, finalState.valueSum, finalState.timeSum, finalState.rankSum)) {
                bestState = finalState;
            }
        }

        return bestState;
    }

    function optimizeJadeRecipeCombination(candidates, requiredRunes, totalGuestRate, totalTimeBonus, groupStats, timeLimitSeconds, enhancedChefs, allRecipes, onlyShowOwned) {
        if (!candidates.length) {
            return null;
        }

        var prepared = prepareJadeCandidates(candidates, requiredRunes, totalGuestRate, totalTimeBonus);
        var preparedCandidates = prepared.preparedCandidates || [];
        if (!preparedCandidates.length) {
            return null;
        }

        var runeBuckets = buildJadeRuneCandidateBuckets(preparedCandidates, requiredRunes);
        var chefLoads = [0, 0, 0];
        var usedRecipeIds = {};
        var runeAssignedCounts = {};
        var selections = [];
        var totalTimeSum = 0;
        var totalValueSum = 0;
        var maxSelections = 9;
        var singleRecipePerRune = settings.singleRecipePerRune === true;
        var selectedEntries = [];
        var perRankChefRequirementMap = buildPerRankChefRequirementMap(enhancedChefs || []);
        var i;

        for (i = 0; i < requiredRunes.length; i++) {
            runeAssignedCounts[requiredRunes[i]] = 0;
        }

        // 第一轮：每个符文先保底一菜
        for (i = 0; i < requiredRunes.length; i++) {
            var rune = requiredRunes[i];
            var basePick = pickNextJadeCandidateForRune(rune, runeBuckets, usedRecipeIds, chefLoads);
            if (!basePick) {
                return null;
            }

            usedRecipeIds[basePick.candidate.recipe.recipeId] = true;
            chefLoads[basePick.assignment.chefIndex]++;
            runeAssignedCounts[rune]++;
            selectedEntries.push({
                candidate: basePick.candidate,
                rune: rune,
                initialAssignment: {
                    chefIndex: basePick.assignment.chefIndex,
                    rank: basePick.assignment.rank
                }
            });
            totalTimeSum += basePick.candidate.cookingTime;
            totalValueSum += basePick.candidate.jadeValue;

            if (selectedEntries.length >= maxSelections) {
                break;
            }
        }

        // 第二轮起：在“当前菜谱数量最少”的符文中，选效率最高的下一道菜
        while (!singleRecipePerRune && totalTimeSum < timeLimitSeconds && selectedEntries.length < maxSelections) {
            var availableCounts = [];
            for (i = 0; i < requiredRunes.length; i++) {
                var currentRune = requiredRunes[i];
                var nextPickPreview = pickNextJadeCandidateForRune(currentRune, runeBuckets, usedRecipeIds, chefLoads);
                if (nextPickPreview) {
                    availableCounts.push(runeAssignedCounts[currentRune] || 0);
                }
            }

            if (!availableCounts.length) {
                break;
            }

            availableCounts.sort(function(a, b) {
                return a - b;
            });

            var chosenSupplementPick = null;

            for (var levelIndex = 0; levelIndex < availableCounts.length; levelIndex++) {
                var targetCount = availableCounts[levelIndex];
                var supplementOptions = [];

                for (i = 0; i < requiredRunes.length; i++) {
                    var supplementRune = requiredRunes[i];
                    if ((runeAssignedCounts[supplementRune] || 0) !== targetCount) {
                        continue;
                    }

                    var supplementPick = pickNextJadeCandidateForRune(supplementRune, runeBuckets, usedRecipeIds, chefLoads);
                    if (supplementPick) {
                        supplementOptions.push({
                            rune: supplementRune,
                            pick: supplementPick
                        });
                    }
                }

                if (!supplementOptions.length) {
                    continue;
                }

                supplementOptions.sort(function(a, b) {
                    return compareJadeCandidatePriority(a.pick.candidate, b.pick.candidate);
                });
                chosenSupplementPick = supplementOptions[0];
                break;
            }

            if (!chosenSupplementPick) {
                break;
            }

            usedRecipeIds[chosenSupplementPick.pick.candidate.recipe.recipeId] = true;
            chefLoads[chosenSupplementPick.pick.assignment.chefIndex]++;
            runeAssignedCounts[chosenSupplementPick.rune]++;
            selectedEntries.push({
                candidate: chosenSupplementPick.pick.candidate,
                rune: chosenSupplementPick.rune,
                initialAssignment: {
                    chefIndex: chosenSupplementPick.pick.assignment.chefIndex,
                    rank: chosenSupplementPick.pick.assignment.rank
                }
            });
            totalTimeSum += chosenSupplementPick.pick.candidate.cookingTime;
            totalValueSum += chosenSupplementPick.pick.candidate.jadeValue;
        }

        if (!selectedEntries.length || totalTimeSum <= 0) {
            return null;
        }

        var optimizedAssignments = optimizeFixedJadeAssignments(selectedEntries, perRankChefRequirementMap);
        for (i = 0; i < selectedEntries.length; i++) {
            var selectedEntry = selectedEntries[i];
            var finalAssignment = optimizedAssignments && optimizedAssignments[i]
                ? optimizedAssignments[i]
                : selectedEntry.initialAssignment;

            selections.push({
                recipe: selectedEntry.candidate.recipe,
                chefIndex: finalAssignment.chefIndex,
                rank: finalAssignment.rank,
                rune: selectedEntry.rune,
                quantity: selectedEntry.candidate.quantity,
                quantityForTime: selectedEntry.candidate.quantityForTime,
                cookingTime: selectedEntry.candidate.cookingTime,
                canAchieveBilai: selectedEntry.candidate.canAchieveBilai,
                requiredPortions: selectedEntry.candidate.requiredPortions,
                maxQuantity: selectedEntry.candidate.maxQuantity,
                jadeValue: selectedEntry.candidate.jadeValue,
                runeOptions: selectedEntry.candidate.runeOptions.slice(),
                isFullPoolSupplement: false
            });
        }

        var usageState = rebuildJadeSelectionUsage(selections);
        var hasPerRankChefs = Object.keys(perRankChefRequirementMap).length > 0;
        var perRankRuneExhausted = false;

        // 第一段补充：优先给 PerRank 厨师补 conditionValue 达标的符文菜谱
        if (!singleRecipePerRune && hasPerRankChefs) {
            while (usageState.totalTimeSum < timeLimitSeconds && selections.length < maxSelections) {
                var bestPerRankRunePick = null;
                var bestPerRankRuneKey = null;

                for (var chefIndexKey in perRankChefRequirementMap) {
                    if (!perRankChefRequirementMap.hasOwnProperty(chefIndexKey)) {
                        continue;
                    }
                    var perRankChefIndex = Number(chefIndexKey);
                    if ((usageState.chefLoads[perRankChefIndex] || 0) >= 3) {
                        continue;
                    }

                    var perRankPick = pickBestPreparedCandidateForChef(
                        preparedCandidates,
                        perRankChefIndex,
                        perRankChefRequirementMap[chefIndexKey],
                        usageState.usedRecipeIds,
                        usageState.chefLoads
                    );

                    if (!perRankPick) {
                        continue;
                    }

                    if (!bestPerRankRunePick || compareJadeCandidatePriority(perRankPick.candidate, bestPerRankRunePick.candidate) < 0) {
                        bestPerRankRunePick = perRankPick;
                        bestPerRankRuneKey = chefIndexKey;
                    }
                }

                if (!bestPerRankRunePick) {
                    perRankRuneExhausted = true;
                    break;
                }

                supplementSelectionsWithPreparedCandidate(
                    selections,
                    bestPerRankRunePick,
                    bestPerRankRunePick.candidate.runeOptions && bestPerRankRunePick.candidate.runeOptions.length ? bestPerRankRunePick.candidate.runeOptions[0] : null,
                    usageState
                );
            }
        }

        if (!singleRecipePerRune && hasPerRankChefs && usageState.totalTimeSum >= timeLimitSeconds) {
            selections = rebalancePerRankSelectionsToOtherChefs(
                selections,
                enhancedChefs || [],
                perRankChefRequirementMap
            );
            usageState = rebuildJadeSelectionUsage(selections);
        }

        // 第二段补充：如果时间达标，或者 PerRank 没有可补的达标符文菜，就用全菜谱给 PerRank 厨师补位
        if (hasPerRankChefs && (singleRecipePerRune || usageState.totalTimeSum >= timeLimitSeconds || perRankRuneExhausted)) {
            selections = supplementPerRankChefSelections(
                selections,
                enhancedChefs || [],
                allRecipes || [],
                onlyShowOwned,
                totalGuestRate,
                totalTimeBonus
            );
            usageState = rebuildJadeSelectionUsage(selections);
        }

        // 第三段补充：如果时间还没达标，再按日均玉璧效率给全队补符文菜谱
        while (!singleRecipePerRune && usageState.totalTimeSum < timeLimitSeconds && selections.length < maxSelections) {
            var bestGeneralRunePick = pickBestPreparedCandidateGlobal(
                preparedCandidates,
                usageState.usedRecipeIds,
                usageState.chefLoads
            );

            if (!bestGeneralRunePick) {
                break;
            }

            supplementSelectionsWithPreparedCandidate(selections, bestGeneralRunePick, null, usageState);
        }

        totalTimeSum = usageState.totalTimeSum;
        totalValueSum = usageState.totalValueSum;

        var actualGuestRate = groupStats ? (groupStats.actualGuestRate || 0) : 0;
        var critRate = groupStats ? (groupStats.critRate || 0) : 0;
        var scatterRate = Math.max(0, 100 - (groupStats ? (groupStats.runeRate || 0) : 0));
        var dailyCycles = totalTimeSum > 0 ? 86400 / totalTimeSum : 0;
        var dailyJade = dailyCycles * (actualGuestRate / 100) * (scatterRate / 100) * (critRate / 100) * totalValueSum;

        return {
            selections: selections,
            totalCookingTime: totalTimeSum,
            recipeJadeValueTotal: totalValueSum,
            dailyJade: dailyJade,
            scatterRate: scatterRate,
            dailyCycles: dailyCycles
        };
    }

    function calculateJadeGroupScreenScore(groupStats) {
        if (!groupStats) {
            return 0;
        }

        var actualGuestRate = groupStats.actualGuestRate || 0;
        var critRate = groupStats.critRate || 0;
        var scatterRate = Math.max(0, 100 - (groupStats.runeRate || 0));
        var timePercentage = Math.max(groupStats.timeBonus || 0, 0.01);

        return actualGuestRate * critRate * scatterRate / timePercentage;
    }

    function getAverageQualityLevelFromSelections(selections) {
        if (!selections || !selections.length) {
            return "1";
        }

        var rankSum = 0;
        var rankCount = 0;

        for (var i = 0; i < selections.length; i++) {
            var selection = selections[i];
            if (!selection || selection.isFullPoolSupplement) {
                continue;
            }

            var rank = Number(selection.rank) || 0;
            if (rank <= 0) {
                continue;
            }

            rankSum += rank;
            rankCount++;
        }

        if (!rankCount) {
            return "1";
        }

        var averageRank = rankSum / rankCount;
        var qualityLevel = Math.floor(averageRank);
        if (qualityLevel < 1) qualityLevel = 1;
        if (qualityLevel > 5) qualityLevel = 5;
        return String(qualityLevel);
    }

    function getJadeGroupEvalLimit(selectedRuneCount, totalGroupCount) {
        var runeCount = Math.max(1, parseInt(selectedRuneCount, 10) || 1);
        var dynamicLimit = Math.floor(50 / Math.sqrt(runeCount));
        if (runeCount >= 4) {
            dynamicLimit = Math.min(dynamicLimit, 20);
        }
        if (runeCount >= 5) {
            dynamicLimit = Math.min(dynamicLimit, 16);
        }
        if (runeCount >= 6) {
            dynamicLimit = Math.min(dynamicLimit, 12);
        }
        dynamicLimit = Math.max(8, dynamicLimit);
        return Math.min(totalGroupCount, dynamicLimit);
    }

    // ========================================
    // 一键查询主函数
    // ========================================
    
    /**
     * 执行一键查询
     * 复用 query.cultivate.js 中的品级计算、光环厨师优化等逻辑
     */
    function executeQuery() {
        if (isQueryInProgress) {
            return null;
        }
        
        isQueryInProgress = true;
        
        try {
            // 获取游戏数据 - 贵客率模式下从 calCustomRule.rules[0] 获取
            // 这个数据包含了个人数据（厨师是否拥有、厨具配置等）
            var rule = (typeof calCustomRule !== 'undefined' && calCustomRule && calCustomRule.rules && calCustomRule.rules[0]) 
                       ? calCustomRule.rules[0] : null;
            
            if (!rule) {
                console.error('游戏数据未加载: calCustomRule.rules[0] 不存在');
                return { success: false, message: '游戏数据未加载' };
            }
            
            // 从 rule 中获取厨师数据（包含个人数据）
            var chefs = rule.chefs || [];
            
            // 从 menus 中提取菜谱数据
            var menus = rule.menus || [];
            var recipes = [];
            for (var m = 0; m < menus.length; m++) {
                if (menus[m].recipe && menus[m].recipe.data) {
                    recipes.push(menus[m].recipe.data);
                }
            }
            
            // 获取游戏数据（包含guests信息）- 用于查询符文菜谱
            var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
                           ? calCustomRule.gameData : null;
            
            if (!gameData || !gameData.guests) {
                console.error('游戏数据未加载: calCustomRule.gameData.guests 不存在');
                return { success: false, message: '游戏数据未加载（缺少贵客数据）' };
            }
            
            
            loadSettings();
            var isJadeMode = isJadeQueryMode();
            
            // ========================================
            // 检查场上是否已有厨师配置
            // 如果有，跳过厨师筛选，直接使用场上配置
            // ========================================
            var existingChefs = [];
            var existingEquips = [];
            var existingPositions = []; // 保存原始位置索引
            var custom = rule.custom;
            
            
            // 从页面UI读取已设置的厨具（包括没有厨师的位置）
            var pageEquipsWithPosition = []; // {position: number, equip: object}
            if (custom) {
                for (var c in custom) {
                    var posIndex = parseInt(c);
                    
                    // 收集厨具信息（无论是否有厨师）
                    if (custom[c].equip && custom[c].equip.equipId) {
                        pageEquipsWithPosition.push({
                            position: posIndex,
                            equip: custom[c].equip
                        });
                    }
                    
                    // 收集厨师信息
                    if (custom[c].chef && custom[c].chef.chefId) {
                        existingChefs.push(custom[c].chef);
                        existingEquips.push(custom[c].equip || null);
                        existingPositions.push(posIndex); // 保存原始位置
                    }
                }
            }
            
            if (pageEquipsWithPosition.length > 0) {
            }
            
            // 根据设置决定是否使用场上已有配置
            // useExistingConfig 开启时：使用场上已有厨师/厨具/心法盘配置
            // useExistingConfig 关闭时：每次都重新走厨师筛选逻辑
            var useExistingChefs = settings.useExistingConfig && existingChefs.length > 0;
            var hasPageEquipsOnly = pageEquipsWithPosition.length > 0 && !useExistingChefs;
            
            if (existingChefs.length > 0 && !settings.useExistingConfig) {
            }
            
            if (useExistingChefs) {
                for (var i = 0; i < existingChefs.length; i++) {
                    var chef = existingChefs[i];
                    var equip = existingEquips[i];
                    if (equip && equip.name) {
                    }
                }
            } else if (hasPageEquipsOnly) {
            }
            
            var result = {
                success: false,
                chefs: [],
                recipes: [],
                positions: [], // 位置信息（含厨师、菜谱、推荐厨具）
                message: '',
                useExistingChefs: useExistingChefs, // 标记是否使用场上已有厨师
                pageEquipsByPosition: null // 页面设置的厨具（按位置索引）
            };
            
            // 读取页面上的"已有"开关状态
            // 勾选时：只使用已有的厨师和菜谱
            // 不勾选时：默认所有厨师和菜谱都视为已有
            var onlyShowOwned = $('#chk-cal-got').is(':checked');
            
            // 读取页面上的"已修炼"开关状态
            // 勾选时：只使用已修炼的厨师
            var onlyShowUltimated = $('#chk-cal-ultimated').is(':checked');
            
            // 如果勾选了已修炼，过滤厨师列表
            if (onlyShowUltimated) {
                var ultimatedChefs = [];
                for (var i = 0; i < chefs.length; i++) {
                    var chef = chefs[i];
                    // 检查厨师是否已修炼
                    if (chef.ultimate === "是") {
                        ultimatedChefs.push(chef);
                    }
                }
                chefs = ultimatedChefs;
            }
            
            var selectedRunes = getSelectedRunes();
            var jadeBaseRecipeData = null;
            
            // 即使没有选择符文，也继续执行厨师筛选，只是跳过菜谱分配
            var hasSelectedRunes = selectedRunes.length > 0;
            
            if (hasSelectedRunes && isJadeMode) {
                jadeBaseRecipeData = buildJadeRecipeBaseData(selectedRunes, recipes, gameData, onlyShowOwned);
            }
            
            // 读取页面上的"已配遗玉"、"已配厨具"和"默认满级心法盘"开关状态
            var useAmberFromPage = $('#chk-cal-use-amber').is(':checked');
            var useEquipFromPage = $('#chk-cal-use-equip').is(':checked');
            var maxDiskFromPage = $('#chk-cal-max-disk').is(':checked');
            
            // 使用之前收集的页面厨具信息（pageEquipsWithPosition）
            // 构建按位置索引的厨具数组
            var pageEquips = [];
            var pageEquipsByPosition = {}; // 按位置索引的厨具映射
            for (var pe = 0; pe < pageEquipsWithPosition.length; pe++) {
                var peItem = pageEquipsWithPosition[pe];
                pageEquips.push(peItem.equip);
                pageEquipsByPosition[peItem.position] = peItem.equip;
            }
            
            // 保存页面厨具信息到结果对象，供 applyResultToSelectors 使用
            result.pageEquipsByPosition = pageEquipsByPosition;
            
            // 使用页面设置的厨具进行计算（优先级高于厨师已配厨具）
            var selectedEquips = pageEquips;
            var hasPageEquips = pageEquips.length > 0;
            
            // 获取技能分析所需的配置数据
            // 如果页面设置了厨具，则不使用厨师已配厨具，而是使用页面设置的厨具
            var useEquip = useEquipFromPage && !hasPageEquips;  // 只有没有页面厨具时才使用厨师已配厨具
            var useAmber = useAmberFromPage;  // 使用页面开关控制是否使用厨师已佩戴的遗玉
            var maxDisk = maxDiskFromPage;    // 使用页面开关控制是否使用默认满级心法盘
            var localData = typeof getLocalData === 'function' ? getLocalData() : null;
            var configUltimatedIds = typeof getConfigUltimatedChefIds === 'function' ? getConfigUltimatedChefIds() : null;
            var qixiaData = null;
            if (typeof calCustomRule !== 'undefined' && calCustomRule.rules && calCustomRule.rules[0]) {
                qixiaData = calCustomRule.rules[0].calQixiaData;
            }
            
            var selectedChefIds = {};
            var allSelectedChefs = [];
            var finalChefs = [];
            var bestGroupStats = null;
            var chefSkillsCache = {};
            
            // ========================================
            // 第一阶段：厨师组合筛选
            // 如果场上已有厨师，跳过筛选，直接使用场上配置
            // ========================================
            var chefCandidateLimitPerCategory = isJadeMode ? 10 : 3;
            if (useExistingChefs) {
                // 使用场上已有的厨师配置
                finalChefs = existingChefs;
                
                // 为场上厨师计算技能值
                for (var i = 0; i < finalChefs.length; i++) {
                    var chef = finalChefs[i];
                    var equip = existingEquips[i];
                    var analysis;
                    
                    if (typeof GuestRateCalculator !== 'undefined' && 
                        typeof GuestRateCalculator.analyzeChefGuestRateSkills === 'function') {
                        analysis = GuestRateCalculator.analyzeChefGuestRateSkills(
                            chef, qixiaData, useEquip, useAmber, localData, configUltimatedIds, 'chef'
                        );
                        chefSkillsCache[chef.chefId] = {
                            guestRate: analysis.skillValues.guestRate || 0,
                            critRate: analysis.skillValues.crit || 0,
                            timeBonus: analysis.skillValues.time || 0,
                            runeRate: analysis.skillValues.rune || 0
                        };
                    } else {
                        var skills = analyzeChefSkills(chef, useEquip);
                        chefSkillsCache[chef.chefId] = {
                            guestRate: skills.guestRate || 0,
                            critRate: skills.critRate || 0,
                            timeBonus: skills.timeBonus || 0,
                            runeRate: skills.runeRate || 0
                        };
                    }
                }
                
                // 获取选中符文对应菜谱的最高星级
                var highestRecipeStarLevel = getHighestRecipeStarLevel(selectedRunes, recipes, gameData, onlyShowOwned);
                var isQueryEfficiencyMode = settings.queryMode;
                
                // 根据模式确定使用的星级和份数
                var calcStarLevel = highestRecipeStarLevel;
                var calcQuantity;
                if (isQueryEfficiencyMode) {
                    // 效率模式：使用该星级对应的最低份数
                    calcQuantity = MIN_QUANTITY_MAP[calcStarLevel] || 7;
                } else {
                    // 必来模式：先计算贵客率，再根据贵客率计算必来份数
                    calcQuantity = MIN_QUANTITY_MAP[calcStarLevel] || 7; // 临时值
                }
                
                // 判断是否是贵客率计算模式
                var isGuestRateModeFlag = calCustomRule && calCustomRule.isGuestRate === true;
                
                // 使用场上配置计算组合统计（根据页面开关控制是否使用厨具、遗玉和满级心法盘）
                var qualityLevel = getRequiredQualityLevelForGroup(finalChefs);
                var customForCalc = {};
                for (var c = 0; c < finalChefs.length; c++) {
                    // 使用辅助函数处理厨师的心法盘数据
                    var chefForCalc = processChefDiskForCalc(finalChefs[c], useAmber, maxDisk, rule, isGuestRateModeFlag);
                    
                    // 确定使用的厨具：优先使用查询设置中选中的厨具，否则使用场上厨师的厨具
                    var equipForCalc = null;
                    if (selectedEquips.length > 0 && c < selectedEquips.length) {
                        // 使用查询设置中选中的厨具
                        equipForCalc = selectedEquips[c];
                    } else if (useEquip) {
                        // 使用场上厨师的厨具
                        equipForCalc = existingEquips[c] || null;
                    }
                    
                    customForCalc[c] = {
                        chef: chefForCalc,
                        equip: equipForCalc,
                        recipes: []
                    };
                }
                
                // 先计算贵客率
                var tempResult = GuestRateCalculator.calculateFields(customForCalc, rule, calcStarLevel, calcQuantity, qualityLevel);
                var guestRate = tempResult.guestRate || 0;
                
                // 必来模式：根据贵客率计算必来份数
                var requiredPortions = 0;
                var canAchieve = true;
                if (!isQueryEfficiencyMode) {
                    requiredPortions = getRequiredPortionsForStarLevel(guestRate, calcStarLevel);
                    var maxQuantityForStar = getUserMaxQuantity(calcStarLevel);
                    canAchieve = requiredPortions <= maxQuantityForStar;
                    // 如果能必来，使用必来份数；否则使用最大份数
                    calcQuantity = canAchieve ? requiredPortions : maxQuantityForStar;
                }
                
                // 使用实际份数重新计算
                var calcResult;
                if (calcQuantity !== (MIN_QUANTITY_MAP[calcStarLevel] || 7)) {
                    calcResult = GuestRateCalculator.calculateFields(customForCalc, rule, calcStarLevel, calcQuantity, qualityLevel);
                } else {
                    calcResult = tempResult;
                }
                
                bestGroupStats = {
                    guestRate: calcResult.guestRate,
                    actualGuestRate: calcResult.actualGuestRate,
                    critRate: calcResult.critRate,
                    timeBonus: calcResult.timePercentage,
                    runeRate: calcResult.runeRate,
                    unitFood: calcResult.unitMaterialOutput,
                    unitTime: calcResult.unitTimeOutput,
                    qualityLevel: qualityLevel,
                    calcStarLevel: calcStarLevel,
                    calcQuantity: calcQuantity,
                    requiredPortions: requiredPortions,
                    canAchieveBilai: canAchieve
                };
                
                if (!isQueryEfficiencyMode) {
                }
                
            } else {
                // 第一阶段：厨师组合筛选
                // 4种分类，每种取前3名，共12个厨师
                // 两种模式（查询效率/查询必来）都使用相同的厨师筛选逻辑
            
            // 步骤1：贵客率厨师（GuestApearRate），取前3名
            var step1Chefs = getSortedChefs(chefs, onlyShowOwned, false, false, false);
            // 打印前10个贵客厨师，显示贵客率
            for (var i = 0; i < Math.min(10, step1Chefs.length); i++) {
                var c = step1Chefs[i];
                // 获取厨师的技能值
                var chefSkills = null;
                if (typeof GuestRateCalculator !== 'undefined' && 
                    typeof GuestRateCalculator.analyzeChefGuestRateSkills === 'function') {
                    chefSkills = GuestRateCalculator.analyzeChefGuestRateSkills(
                        c, qixiaData, useEquip, useAmber, localData, configUltimatedIds, 'chef'
                    );
                }
                var guestRate = chefSkills ? (chefSkills.skillValues.guestRate || 0) : 0;
            }
            var step1Count = 0;
            for (var i = 0; i < step1Chefs.length && step1Count < chefCandidateLimitPerCategory; i++) {
                var chef = step1Chefs[i];
                if (!selectedChefIds[chef.chefId]) {
                    allSelectedChefs.push(chef);
                    selectedChefIds[chef.chefId] = true;
                    step1Count++;
                }
            }
            
            // 步骤2：暴击厨师（GuestDropCount），取前3名（排除已选择的）
            var step2Chefs = getSortedChefs(chefs, onlyShowOwned, true, false, false);
            // 打印前10个暴击厨师，并标记已选中的，显示暴击率和贵客率
            for (var i = 0; i < Math.min(10, step2Chefs.length); i++) {
                var c = step2Chefs[i];
                var alreadySelected = selectedChefIds[c.chefId] ? ' [已选中]' : '';
                // 获取厨师的技能值
                var chefSkills = null;
                if (typeof GuestRateCalculator !== 'undefined' && 
                    typeof GuestRateCalculator.analyzeChefGuestRateSkills === 'function') {
                    chefSkills = GuestRateCalculator.analyzeChefGuestRateSkills(
                        c, qixiaData, useEquip, useAmber, localData, configUltimatedIds, 'chef'
                    );
                }
                var critRate = chefSkills ? (chefSkills.skillValues.crit || 0) : 0;
                var guestRate = chefSkills ? (chefSkills.skillValues.guestRate || 0) : 0;
            }
            var step2Count = 0;
            for (var i = 0; i < step2Chefs.length && step2Count < chefCandidateLimitPerCategory; i++) {
                var chef = step2Chefs[i];
                if (!selectedChefIds[chef.chefId]) {
                    allSelectedChefs.push(chef);
                    selectedChefIds[chef.chefId] = true;
                    step2Count++;
                }
            }
            
            // 步骤3：刺客厨师（OpenTime），取前3名（排除已选择的）
            var step3Chefs = getSortedChefs(chefs, onlyShowOwned, false, true, false);
            // 打印前10个刺客厨师，并标记已选中的，显示时间和贵客率
            for (var i = 0; i < Math.min(10, step3Chefs.length); i++) {
                var c = step3Chefs[i];
                var alreadySelected = selectedChefIds[c.chefId] ? ' [已选中]' : '';
                // 获取厨师的技能值
                var chefSkills = null;
                if (typeof GuestRateCalculator !== 'undefined' && 
                    typeof GuestRateCalculator.analyzeChefGuestRateSkills === 'function') {
                    chefSkills = GuestRateCalculator.analyzeChefGuestRateSkills(
                        c, qixiaData, useEquip, useAmber, localData, configUltimatedIds, 'chef'
                    );
                }
                var timeBonus = chefSkills ? (chefSkills.skillValues.time || 0) : 0;
                var guestRate = chefSkills ? (chefSkills.skillValues.guestRate || 0) : 0;
            }
            var step3Count = 0;
            for (var i = 0; i < step3Chefs.length && step3Count < chefCandidateLimitPerCategory; i++) {
                var chef = step3Chefs[i];
                if (!selectedChefIds[chef.chefId]) {
                    allSelectedChefs.push(chef);
                    selectedChefIds[chef.chefId] = true;
                    step3Count++;
                }
            }
            
            // 步骤4：符文厨师（GuestAntiqueDropRate），取前3名（排除已选择的）
            var step4Chefs = getSortedChefs(chefs, onlyShowOwned, false, false, true);
            // 打印前10个符文厨师，并标记已选中的，显示符文率和贵客率
            for (var i = 0; i < Math.min(10, step4Chefs.length); i++) {
                var c = step4Chefs[i];
                var alreadySelected = selectedChefIds[c.chefId] ? ' [已选中]' : '';
                // 获取厨师的技能值
                var chefSkills = null;
                if (typeof GuestRateCalculator !== 'undefined' && 
                    typeof GuestRateCalculator.analyzeChefGuestRateSkills === 'function') {
                    chefSkills = GuestRateCalculator.analyzeChefGuestRateSkills(
                        c, qixiaData, useEquip, useAmber, localData, configUltimatedIds, 'chef'
                    );
                }
                var runeRate = chefSkills ? (chefSkills.skillValues.rune || 0) : 0;
                var guestRate = chefSkills ? (chefSkills.skillValues.guestRate || 0) : 0;
            }
            var step4Count = 0;
            for (var i = 0; i < step4Chefs.length && step4Count < chefCandidateLimitPerCategory; i++) {
                var chef = step4Chefs[i];
                if (!selectedChefIds[chef.chefId]) {
                    allSelectedChefs.push(chef);
                    selectedChefIds[chef.chefId] = true;
                    step4Count++;
                }
            }
            
            // 打印最终选中的所有厨师
            for (var i = 0; i < allSelectedChefs.length; i++) {
            }
            
            // 生成所有可能的3人组合
            var chefGroups = generateChefCombinations(allSelectedChefs);
            
            // 预先计算所有厨师的技能值（使用GuestRateCalculator）
            for (var i = 0; i < allSelectedChefs.length; i++) {
                var chef = allSelectedChefs[i];
                var analysis;
                
                if (typeof GuestRateCalculator !== 'undefined' && 
                    typeof GuestRateCalculator.analyzeChefGuestRateSkills === 'function') {
                    analysis = GuestRateCalculator.analyzeChefGuestRateSkills(
                        chef, qixiaData, useEquip, useAmber, localData, configUltimatedIds, 'chef'
                    );
                    chefSkillsCache[chef.chefId] = {
                        guestRate: analysis.skillValues.guestRate || 0,
                        critRate: analysis.skillValues.crit || 0,
                        timeBonus: analysis.skillValues.time || 0,
                        runeRate: analysis.skillValues.rune || 0
                    };
                } else {
                    var skills = analyzeChefSkills(chef, useEquip);
                    chefSkillsCache[chef.chefId] = {
                        guestRate: skills.guestRate || 0,
                        critRate: skills.critRate || 0,
                        timeBonus: skills.timeBonus || 0,
                        runeRate: skills.runeRate || 0
                    };
                }
            }
            
            // 计算每组的最优指标，选择最优组合
            // 查询效率模式：使用符文最高星级对应的最低份数（5星=7份，4星=10份等）
            // 查询必来模式：使用符文最高星级 + 该星级对应的必来份数
            // 调用 GuestRateCalculator.calculateFields 进行计算
            var bestGroup = null;
            var bestScore = -1; // 用于比较的分数（查询效率=单位时间，查询必来=贵客率）
            var bestJadeScore = -1;
            var isQueryEfficiencyMode = settings.queryMode;
            var jadeGroupCandidates = [];
            
            // 查询必来模式专用：记录能达到必来的最优组合和贵客率最高的组合
            var bestCanAchieveGroup = null; // 能达到必来的最优组合
            var bestCanAchieveScore = -1;   // 能达到必来的组合中，百锅产出最高分
            var bestCanAchieveStats = null;
            var highestGuestRateGroup = null; // 贵客率最高的组合（备用，无法必来时使用）
            var highestGuestRateScore = -1;
            var highestGuestRateStats = null;
            var highestJadeGuestRateScreenScore = -1;
            var jadeReachedActualBilaiCandidates = [];
            var canAchieveBilai = false; // 是否有组合能达到必来
            
            // 获取选中符文对应菜谱的最高星级
            var highestRecipeStarLevel = getHighestRecipeStarLevel(selectedRunes, recipes, gameData, onlyShowOwned);
            
            // 根据模式确定使用的星级和份数
            var calcStarLevel = highestRecipeStarLevel;
            var calcQuantity;
            if (isQueryEfficiencyMode) {
                // 效率模式：使用该星级对应的最低份数
                calcQuantity = MIN_QUANTITY_MAP[calcStarLevel] || 7;
            } else {
                // 必来模式：份数需要根据每个组合的贵客率动态计算，这里先用最低份数
                // 实际的必来份数会在循环中根据贵客率计算
                calcQuantity = MIN_QUANTITY_MAP[calcStarLevel] || 7;
            }
            var maxQuantityForStar = getUserMaxQuantity(calcStarLevel); // 获取用户实际最大份数（含修炼加成）
            
            // 判断是否是贵客率计算模式
            var isGuestRateModeFlag = calCustomRule && calCustomRule.isGuestRate === true;
            
            if (!isQueryEfficiencyMode) {
            }
            
            for (var g = 0; g < chefGroups.length; g++) {
                var group = chefGroups[g];
                
                // 检查组合中符文技能的品级要求
                var qualityLevel = getRequiredQualityLevelForGroup(group);
                
                // 构建 custom 对象用于 calculateFields（根据页面开关控制是否使用厨具、遗玉和满级心法盘）
                var customForCalc = {};
                for (var c = 0; c < group.length; c++) {
                    // 使用辅助函数处理厨师的心法盘数据
                    var chefForCalc = processChefDiskForCalc(group[c], useAmber, maxDisk, rule, isGuestRateModeFlag);
                    
                    // 确定使用的厨具：优先使用查询设置中选中的厨具，否则使用厨师自带的厨具
                    var equipForCalc = null;
                    if (selectedEquips.length > 0 && c < selectedEquips.length) {
                        // 使用查询设置中选中的厨具
                        equipForCalc = selectedEquips[c];
                    } else if (useEquip) {
                        // 使用厨师自带的厨具
                        equipForCalc = group[c].equip || null;
                    }
                    
                    customForCalc[c] = {
                        chef: chefForCalc,
                        equip: equipForCalc,
                        recipes: [] // 一键查询时不需要菜谱信息
                    };
                }
                
                // 先计算贵客率（用于必来模式计算必来份数）
                var tempResult = GuestRateCalculator.calculateFields(customForCalc, rule, calcStarLevel, calcQuantity, qualityLevel);
                var guestRate = tempResult.guestRate || 0;
                
                // 根据模式确定实际使用的份数
                var actualQuantity = calcQuantity;
                var requiredPortions = 0;
                var canAchieve = true;
                
                if (!isQueryEfficiencyMode) {
                    // 必来模式：根据贵客率计算必来份数
                    requiredPortions = getRequiredPortionsForStarLevel(guestRate, calcStarLevel);
                    canAchieve = requiredPortions <= maxQuantityForStar;
                    // 如果能必来，使用必来份数；否则使用最大份数
                    actualQuantity = canAchieve ? requiredPortions : maxQuantityForStar;
                }
                
                // 使用实际份数重新计算（如果份数变化了）
                var calcResult;
                if (actualQuantity !== calcQuantity) {
                    calcResult = GuestRateCalculator.calculateFields(customForCalc, rule, calcStarLevel, actualQuantity, qualityLevel);
                } else {
                    calcResult = tempResult;
                }
                
                var unitTime = calcResult.unitTimeOutput || 0;
                
                // 打印前10组的计算结果
                if (g < 10) {
                    if (!isQueryEfficiencyMode) {
                    }
                }
                
                var groupStats = {
                    guestRate: calcResult.guestRate,
                    actualGuestRate: calcResult.actualGuestRate,
                    critRate: calcResult.critRate,
                    timeBonus: calcResult.timePercentage,
                    runeRate: calcResult.runeRate,
                    unitFood: calcResult.unitMaterialOutput,
                    unitTime: unitTime,
                    qualityLevel: qualityLevel,
                    requiredPortions: requiredPortions,
                    canAchieveBilai: canAchieve,
                    calcStarLevel: calcStarLevel,      // 计算使用的星级
                    calcQuantity: actualQuantity       // 计算使用的份数
                };
                
                if (isJadeMode) {
                    var jadeScreenScore = calculateJadeGroupScreenScore(groupStats);
                    jadeGroupCandidates.push({
                        group: group,
                        groupStats: groupStats,
                        screenScore: jadeScreenScore
                    });

                    if (!isQueryEfficiencyMode) {
                        if (groupStats.guestRate > highestGuestRateScore ||
                            (groupStats.guestRate === highestGuestRateScore && jadeScreenScore > highestJadeGuestRateScreenScore)) {
                            highestGuestRateScore = groupStats.guestRate;
                            highestGuestRateGroup = group;
                            highestGuestRateStats = groupStats;
                            highestJadeGuestRateScreenScore = jadeScreenScore;
                        }
                        if ((groupStats.actualGuestRate || 0) >= 100) {
                            jadeReachedActualBilaiCandidates.push({
                                group: group,
                                groupStats: groupStats,
                                screenScore: jadeScreenScore
                            });
                        }
                    }
                } else if (isQueryEfficiencyMode) {
                    // 查询效率模式：按单位时间最高
                    if (unitTime > bestScore) {
                        bestScore = unitTime;
                        bestGroup = group;
                        bestGroupStats = groupStats;
                    }
                } else {
                    // 查询必来模式：
                    // 1. 记录贵客率最高的组合（备用，所有组合都无法必来时使用）
                    if (guestRate > highestGuestRateScore) {
                        highestGuestRateScore = guestRate;
                        highestGuestRateGroup = group;
                        highestGuestRateStats = groupStats;
                    }
                    
                    // 2. 在能达到必来的组合中，选择百锅产出（unitTime）最高的
                    if (canAchieve && unitTime > bestCanAchieveScore) {
                        bestCanAchieveScore = unitTime;
                        bestCanAchieveGroup = group;
                        bestCanAchieveStats = groupStats;
                        canAchieveBilai = true;
                    }
                }
            }
            
            if (isJadeMode) {
                if (isQueryEfficiencyMode) {
                    jadeGroupCandidates.sort(function(a, b) {
                        return b.screenScore - a.screenScore;
                    });

                    var jadeGroupEvalLimit = getJadeGroupEvalLimit(
                        jadeBaseRecipeData ? jadeBaseRecipeData.availableRunes.length : selectedRunes.length,
                        jadeGroupCandidates.length
                    );
                    for (var jg = 0; jg < jadeGroupEvalLimit; jg++) {
                        var jadeGroupCandidate = jadeGroupCandidates[jg];
                        var enhancedChefsForJade = buildEnhancedChefsForGroup(
                            jadeGroupCandidate.group,
                            false,
                            [],
                            pageEquipsByPosition,
                            useEquip
                        );
                        var jadeGroupData = buildJadeRecipeCandidatesForGroup(
                            jadeBaseRecipeData ? jadeBaseRecipeData.baseCandidates : [],
                            enhancedChefsForJade
                        );
                        var jadeGroupRunes = getJadeAvailableRunesFromCandidates(
                            jadeGroupData.candidates,
                            jadeBaseRecipeData ? jadeBaseRecipeData.availableRunes : []
                        );
                        var jadeOptimization = optimizeJadeRecipeCombination(
                            jadeGroupData.candidates,
                            jadeGroupRunes,
                            jadeGroupCandidate.groupStats.guestRate,
                            jadeGroupCandidate.groupStats.timeBonus - 100,
                            jadeGroupCandidate.groupStats,
                            settings.defaultTime * 3600,
                            enhancedChefsForJade,
                            recipes,
                            onlyShowOwned
                        );

                        if (jadeOptimization && jadeOptimization.dailyJade > bestJadeScore) {
                            bestJadeScore = jadeOptimization.dailyJade;
                            bestGroup = jadeGroupCandidate.group;
                            bestGroupStats = jadeGroupCandidate.groupStats;
                        }
                    }
                } else {
                    if (jadeReachedActualBilaiCandidates.length <= 1) {
                        if (jadeReachedActualBilaiCandidates.length === 1) {
                            bestGroup = jadeReachedActualBilaiCandidates[0].group;
                            bestGroupStats = jadeReachedActualBilaiCandidates[0].groupStats;
                        } else {
                            bestGroup = highestGuestRateGroup;
                            bestGroupStats = highestGuestRateStats;
                        }
                    } else {
                        jadeReachedActualBilaiCandidates.sort(function(a, b) {
                            return b.screenScore - a.screenScore;
                        });
                        for (var jb = 0; jb < jadeReachedActualBilaiCandidates.length; jb++) {
                            var jadeBilaiCandidate = jadeReachedActualBilaiCandidates[jb];
                            var enhancedChefsForBilai = buildEnhancedChefsForGroup(
                                jadeBilaiCandidate.group,
                                false,
                                [],
                                pageEquipsByPosition,
                                useEquip
                            );
                            var jadeBilaiGroupData = buildJadeRecipeCandidatesForGroup(
                                jadeBaseRecipeData ? jadeBaseRecipeData.baseCandidates : [],
                                enhancedChefsForBilai
                            );
                            var jadeBilaiGroupRunes = getJadeAvailableRunesFromCandidates(
                                jadeBilaiGroupData.candidates,
                                jadeBaseRecipeData ? jadeBaseRecipeData.availableRunes : []
                            );
                            var bilaiOptimization = optimizeJadeRecipeCombination(
                                jadeBilaiGroupData.candidates,
                                jadeBilaiGroupRunes,
                                jadeBilaiCandidate.groupStats.guestRate,
                                jadeBilaiCandidate.groupStats.timeBonus - 100,
                                jadeBilaiCandidate.groupStats,
                                settings.defaultTime * 3600,
                                enhancedChefsForBilai,
                                recipes,
                                onlyShowOwned
                            );

                            if (bilaiOptimization && bilaiOptimization.dailyJade > bestJadeScore) {
                                bestJadeScore = bilaiOptimization.dailyJade;
                                bestGroup = jadeBilaiCandidate.group;
                                bestGroupStats = jadeBilaiCandidate.groupStats;
                            }
                        }

                        if (!bestGroup) {
                            bestGroup = highestGuestRateGroup;
                            bestGroupStats = highestGuestRateStats;
                        }
                    }
                }
            }

            // 查询必来模式：确定最终使用的组合
            if (!isJadeMode && !isQueryEfficiencyMode) {
                if (canAchieveBilai) {
                    // 有能达到必来的组合，使用百锅产出最高的
                    bestGroup = bestCanAchieveGroup;
                    bestGroupStats = bestCanAchieveStats;
                } else {
                    // 所有组合都无法必来，使用贵客率最高的组合
                    bestGroup = highestGuestRateGroup;
                    bestGroupStats = highestGuestRateStats;
                    bestGroupStats.cannotAchieveBilai = true; // 标记无法必来
                }
            }
            
            // 使用最优组合
            finalChefs = bestGroup || allSelectedChefs.slice(0, 3);
            
            for (var i = 0; i < finalChefs.length; i++) {
            }
            if (bestGroupStats) {
            }
            
            } // 结束 else 分支（厨师筛选）
            
            // 设置结果中的厨师
            result.chefs = finalChefs;
            
            // 使用组合统计中的贵客率（已正确计算Partial技能效果）
            var totalGuestRate = bestGroupStats ? bestGroupStats.guestRate : 0;
            var totalTimeBonus = bestGroupStats ? (bestGroupStats.timeBonus - 100) : 0; // timeBonus是百分比，需要减去基础100%

            // 第二阶段：菜谱分配（按品级评分分配给最佳厨师）
            // 核心逻辑：对于每个符文的菜谱，找到能制作最高品级的厨师来分配
            
            var usedRecipeIds = {};
            var totalGodCount = 0;
            
            // 检查场上3个厨师中是否有光环类厨师（Partial技法加成）
            var onFieldAuraChefs = [];
            for (var i = 0; i < finalChefs.length; i++) {
                var chef = finalChefs[i];
                var skillBonus = getEmptySkillBonus();
                var hasPartialSkill = false;
                var conditionType = null;
                var conditionValueList = null;
                
                // 检查修炼技能是否有Partial类型（使用厨师自身的修炼状态）
                if (chef.ultimate === "是") {
                    if (chef.ultimateSkillEffect) {
                        for (var j = 0; j < chef.ultimateSkillEffect.length; j++) {
                            var effect = chef.ultimateSkillEffect[j];
                            if (effect.condition === 'Partial' && isSkillBonusType(effect.type)) {
                                extractSkillBonus(effect, skillBonus);
                                hasPartialSkill = true;
                                if (effect.conditionType) conditionType = effect.conditionType;
                                if (effect.conditionValueList) conditionValueList = effect.conditionValueList;
                            }
                        }
                    }
                }
                
                if (hasPartialSkill) {
                    onFieldAuraChefs.push({
                        chef: chef,
                        chefIndex: i,
                        skillBonus: skillBonus,
                        conditionType: conditionType,
                        conditionValueList: conditionValueList
                    });
                }
            }
            
            // 为每个厨师计算技法值（含厨具加成 + 场上光环厨师加成）
            // 如果页面设置了厨具，优先使用页面设置的厨具
            var enhancedChefs = [];
            for (var i = 0; i < finalChefs.length; i++) {
                var chef = finalChefs[i];
                
                // 获取该位置对应的原始位置（用于查找页面设置的厨具）
                var originalPosition = useExistingChefs ? existingPositions[i] : i;
                var pageEquipForPosition = pageEquipsByPosition[originalPosition] || null;
                
                // 收集场上光环厨师对该厨师的加成效果
                var partialAdds = [];
                var auraBonus = getEmptySkillBonus(); // 用于日志显示
                for (var a = 0; a < onFieldAuraChefs.length; a++) {
                    var auraChef = onFieldAuraChefs[a];
                    // 光环厨师不给自己加成
                    if (auraChef.chefIndex === i) continue;
                    // 检查条件是否满足
                    if (checkAuraCondition(chef, auraChef)) {
                        // 收集该光环厨师的修炼技能效果
                        if (auraChef.chef.ultimateSkillEffect) {
                            for (var e = 0; e < auraChef.chef.ultimateSkillEffect.length; e++) {
                                var effect = auraChef.chef.ultimateSkillEffect[e];
                                if (effect.condition === 'Partial' && isSkillBonusType(effect.type)) {
                                    partialAdds.push(effect);
                                }
                            }
                        }
                        auraBonus = combineSkillBonus(auraBonus, auraChef.skillBonus);
                    }
                }
                
                // 计算技法值（包含光环加成）
                var boostedChef;
                if (pageEquipForPosition) {
                    // 使用页面设置的厨具（优先级高于厨师已配厨具）
                    boostedChef = getChefWithFullBonus(chef, false, pageEquipForPosition, partialAdds);
                } else {
                    // 使用厨师已配厨具（如果启用）
                    boostedChef = getChefWithFullBonus(chef, useEquip, null, partialAdds);
                }
                
                // 打印每个厨师的最终技法值
                var hasAuraBonus = getTotalSkillBonus(auraBonus) > 0;
                
                enhancedChefs.push({
                    original: chef,
                    enhanced: boostedChef,
                    auraBonus: auraBonus,
                    recipes: [], // 分配给该厨师的菜谱
                    originalPosition: originalPosition // 保存原始位置，用于正确设置菜谱
                });
            }
            
            // 如果没有选择符文，跳过菜谱分配，直接返回厨师组合结果
            if (!hasSelectedRunes) {
                
                // 计算应该使用的份数
                var isQueryEfficiencyMode = settings.queryMode;
                var defaultStarLevel = 5;
                var calculatedQuantity = 7; // 默认7份
                
                if (!isQueryEfficiencyMode && bestGroupStats) {
                    // 查询必来模式：根据贵客率计算必来份数
                    var requiredPortions = getRequiredPortionsForStarLevel(bestGroupStats.guestRate, defaultStarLevel);
                    var maxQuantity = getUserMaxQuantity(defaultStarLevel); // 获取用户实际最大份数（含修炼加成）
                    calculatedQuantity = Math.min(requiredPortions, maxQuantity);
                    
                    // 检查是否无法达到必来
                    if (requiredPortions > maxQuantity) {
                        result.cannotAchieveBilai = true;
                    }
                } else {
                }
                
                // 构建位置信息（只有厨师，没有菜谱）
                var positions = [];
                for (var i = 0; i < enhancedChefs.length; i++) {
                    var chefData = enhancedChefs[i];
                    positions.push({
                        type: 'target',
                        chef: chefData.original,
                        recipes: [],
                        recipeDetails: [],
                        godCount: 0,
                        cookingTime: 0,
                        auraBonus: getTotalSkillBonus(chefData.auraBonus) > 0 ? chefData.auraBonus : null,
                        originalPosition: chefData.originalPosition // 保存原始位置
                    });
                }
                
                // 如果使用场上已有厨师，需要按原始位置重新排列positions数组
                if (useExistingChefs && positions.length > 0) {
                    var sortedPositions = [];
                    // 创建3个空位置
                    for (var p = 0; p < 3; p++) {
                        sortedPositions.push({
                            type: 'empty',
                            chef: null,
                            recipes: [],
                            recipeDetails: [],
                            godCount: 0,
                            cookingTime: 0,
                            auraBonus: null,
                            originalPosition: p
                        });
                    }
                    // 将厨师放到正确的位置
                    for (var p = 0; p < positions.length; p++) {
                        var pos = positions[p];
                        var origPos = pos.originalPosition;
                        if (origPos !== undefined && origPos >= 0 && origPos < 3) {
                            sortedPositions[origPos] = pos;
                        }
                    }
                    positions = sortedPositions;
                }
                
                result.chefs = finalChefs;
                result.positions = positions;
                result.totalGuestRate = totalGuestRate;
                result.totalTimeBonus = totalTimeBonus;
                result.totalCookingTime = 0;
                result.timeReached = false;
                result.qualityLevel = bestGroupStats ? bestGroupStats.qualityLevel : "4";
                result.calculatedQuantity = calculatedQuantity; // 添加计算出的份数
                
                // 标记是否无法达到必来（从bestGroupStats继承）
                if (bestGroupStats && bestGroupStats.cannotAchieveBilai) {
                    result.cannotAchieveBilai = true;
                }
                
                result.success = true;
                result.message = '厨师组合查询完成（未选择符文，请在设置中选择符文以分配菜谱）';
                result.noRuneSelected = true; // 标记未选择符文
                
                if (bestGroupStats) {
                }
                
                return result;
            }

            if (isJadeMode) {
                var finalJadeGroupData = buildJadeRecipeCandidatesForGroup(
                    jadeBaseRecipeData ? jadeBaseRecipeData.baseCandidates : [],
                    enhancedChefs
                );
                var finalJadeAvailableRunes = getJadeAvailableRunesFromCandidates(
                    finalJadeGroupData.candidates,
                    jadeBaseRecipeData ? jadeBaseRecipeData.availableRunes : []
                );
                var finalJadeOptimization = optimizeJadeRecipeCombination(
                    finalJadeGroupData.candidates,
                    finalJadeAvailableRunes,
                    totalGuestRate,
                    totalTimeBonus,
                    bestGroupStats,
                    settings.defaultTime * 3600,
                    enhancedChefs,
                    recipes,
                    onlyShowOwned
                );

                if (jadeBaseRecipeData && jadeBaseRecipeData.conflictCount > 0) {
                    result.conflictInfo = jadeBaseRecipeData.conflictInfo;
                    result.conflictCount = jadeBaseRecipeData.conflictCount;
                }
                if (finalJadeGroupData.cannotMakeCount > 0) {
                    result.cannotMakeInfo = finalJadeGroupData.cannotMakeInfo;
                    result.cannotMakeCount = finalJadeGroupData.cannotMakeCount;
                }

                if (!finalJadeOptimization || !finalJadeOptimization.selections.length) {
                    return {
                        success: false,
                        chefs: finalChefs,
                        recipes: [],
                        useExistingChefs: useExistingChefs,
                        pageEquipsByPosition: result.pageEquipsByPosition,
                        message: '未找到满足所选符文条件的刷玉组合'
                    };
                }

                var jadePositions = [];
                var jadeTotalRecipes = 0;
                var jadeTotalGodCount = 0;
                var jadeCannotAchieveStarLevels = {};
                var jadeCannotAchieveRecipes = [];

                for (var js = 0; js < finalJadeOptimization.selections.length; js++) {
                    var jadeSelection = finalJadeOptimization.selections[js];
                    enhancedChefs[jadeSelection.chefIndex].recipes.push({
                        recipe: jadeSelection.recipe,
                        rank: jadeSelection.rank,
                        rune: jadeSelection.rune || (jadeSelection.runeOptions[0] || null),
                        quantity: jadeSelection.quantity,
                        cookingTime: jadeSelection.cookingTime,
                        canAchieveBilai: jadeSelection.canAchieveBilai
                    });
                }

                for (var ji = 0; ji < enhancedChefs.length; ji++) {
                    var jadeChefData = enhancedChefs[ji];
                    var jadeChefRecipes = [];
                    var jadeRecipeDetails = [];
                    var jadeGodCount = 0;
                    var jadeChefCookingTime = 0;

                    for (var jj = 0; jj < jadeChefData.recipes.length; jj++) {
                        var jadeRecipeData = jadeChefData.recipes[jj];
                        var jadeRecipe = jadeRecipeData.recipe;

                        jadeChefRecipes.push(jadeRecipe);
                        jadeRecipeDetails.push({
                            recipe: jadeRecipe,
                            rank: jadeRecipeData.rank,
                            rune: jadeRecipeData.rune,
                            quantity: jadeRecipeData.quantity,
                            cookingTime: jadeRecipeData.cookingTime,
                            canAchieveBilai: jadeRecipeData.canAchieveBilai
                        });

                        if (jadeRecipeData.rank >= 4) {
                            jadeGodCount++;
                            jadeTotalGodCount++;
                        }
                        if (!jadeRecipeData.canAchieveBilai) {
                            var jadeStarLevel = jadeRecipe.rarity || 5;
                            jadeCannotAchieveStarLevels[jadeStarLevel] = true;
                            jadeCannotAchieveRecipes.push(jadeRecipe.name);
                        }

                        jadeChefCookingTime += jadeRecipeData.cookingTime;
                    }

                    jadePositions.push({
                        type: 'target',
                        chef: jadeChefData.original,
                        recipes: jadeChefRecipes,
                        recipeDetails: jadeRecipeDetails,
                        godCount: jadeGodCount,
                        cookingTime: jadeChefCookingTime,
                        auraBonus: getTotalSkillBonus(jadeChefData.auraBonus) > 0 ? jadeChefData.auraBonus : null,
                        originalPosition: jadeChefData.originalPosition
                    });

                    result.recipes = result.recipes.concat(jadeChefRecipes);
                    jadeTotalRecipes += jadeChefRecipes.length;
                }

                if (useExistingChefs && jadePositions.length > 0) {
                    var sortedJadePositions = [];
                    for (var jp = 0; jp < 3; jp++) {
                        sortedJadePositions.push({
                            type: 'empty',
                            chef: null,
                            recipes: [],
                            recipeDetails: [],
                            godCount: 0,
                            cookingTime: 0,
                            auraBonus: null,
                            originalPosition: jp
                        });
                    }
                    for (var jpos = 0; jpos < jadePositions.length; jpos++) {
                        var jadePosition = jadePositions[jpos];
                        var jadeOriginalPosition = jadePosition.originalPosition;
                        if (jadeOriginalPosition !== undefined && jadeOriginalPosition >= 0 && jadeOriginalPosition < 3) {
                            sortedJadePositions[jadeOriginalPosition] = jadePosition;
                        }
                    }
                    jadePositions = sortedJadePositions;
                }

                result.positions = jadePositions;
                result.totalGuestRate = totalGuestRate;
                result.totalTimeBonus = totalTimeBonus;
                result.totalCookingTime = finalJadeOptimization.totalCookingTime;
                result.timeReached = finalJadeOptimization.totalCookingTime >= settings.defaultTime * 3600;
                result.qualityLevel = getAverageQualityLevelFromSelections(finalJadeOptimization.selections);
                result.dailyJade = finalJadeOptimization.dailyJade;
                result.recipeJadeValueTotal = finalJadeOptimization.recipeJadeValueTotal;

                var jadeCannotAchieveStarList = Object.keys(jadeCannotAchieveStarLevels).map(Number).sort();
                if (jadeCannotAchieveStarList.length > 0) {
                    result.cannotAchieveStarLevels = jadeCannotAchieveStarList;
                    result.cannotAchieveRecipes = jadeCannotAchieveRecipes;
                }
                if (bestGroupStats && bestGroupStats.cannotAchieveBilai) {
                    result.cannotAchieveBilai = true;
                }

                var calculatedStarLevelForJade = 5;
                var calculatedQuantityForJade = 7;
                if (bestGroupStats) {
                    calculatedStarLevelForJade = bestGroupStats.calcStarLevel || 5;
                    if (!isQueryEfficiencyMode && !bestGroupStats.canAchieveBilai && bestGroupStats.requiredPortions) {
                        calculatedQuantityForJade = bestGroupStats.requiredPortions;
                    } else {
                        calculatedQuantityForJade = bestGroupStats.calcQuantity || 7;
                    }
                }
                result.calculatedStarLevel = calculatedStarLevelForJade;
                result.calculatedQuantity = calculatedQuantityForJade;

                result.success = true;

                var jadeMessage = '一键查询完成（日均玉璧' +
                    (Math.floor(finalJadeOptimization.dailyJade * 100) / 100).toFixed(2) + '，' +
                    jadeTotalGodCount + '/' + jadeTotalRecipes + '达神）';

                var jadeWarningParts = [];
                if (result.conflictCount > 0) {
                    jadeWarningParts.push('冲突菜谱' + result.conflictCount + '个');
                }
                if (result.cannotMakeCount > 0) {
                    jadeWarningParts.push('无法制作' + result.cannotMakeCount + '个');
                }
                if (jadeWarningParts.length > 0) {
                    jadeMessage += ' [已排除: ' + jadeWarningParts.join('，') + ']';
                }

                result.message = jadeMessage;
                return result;
            }
            
            // 构建菜谱名称到菜谱对象的映射
            var recipeByName = {};
            for (var i = 0; i < recipes.length; i++) {
                var recipe = recipes[i];
                if (recipe.name) {
                    recipeByName[recipe.name] = recipe;
                }
            }
            
            // ========================================
            // 贵客冲突检测（与show项目一致）
            // 同一贵客对应多个菜谱时，选择调整后时间最短的
            // ========================================
            
            // 第一步：收集所有选中符文对应的菜谱
            var allRuneRecipes = [];
            var recipeToRunesMap = {}; // 菜谱名 -> 符文列表
            
            for (var r = 0; r < selectedRunes.length; r++) {
                var rune = selectedRunes[r];
                
                for (var g = 0; g < gameData.guests.length; g++) {
                    var guest = gameData.guests[g];
                    if (!guest.gifts) continue;
                    
                    for (var gf = 0; gf < guest.gifts.length; gf++) {
                        var gift = guest.gifts[gf];
                        if (gift.antique !== rune) continue;
                        
                        var recipe = recipeByName[gift.recipe];
                        if (!recipe) continue;
                        if (onlyShowOwned && recipe.got !== "是") continue;
                        
                        // 记录菜谱对应的符文
                        if (!recipeToRunesMap[recipe.name]) {
                            recipeToRunesMap[recipe.name] = [];
                            allRuneRecipes.push(recipe);
                        }
                        if (recipeToRunesMap[recipe.name].indexOf(rune) === -1) {
                            recipeToRunesMap[recipe.name].push(rune);
                        }
                    }
                }
            }
            
            
            // 第二步：按贵客分组菜谱（跨符文）
            var recipesByGuest = {}; // 贵客名 -> 菜谱列表
            
            for (var i = 0; i < allRuneRecipes.length; i++) {
                var recipe = allRuneRecipes[i];
                
                for (var g = 0; g < gameData.guests.length; g++) {
                    var guest = gameData.guests[g];
                    if (!guest.gifts) continue;
                    
                    // 检查该贵客是否对当前菜谱有选择（在选中的符文中）
                    var hasRecipeForSelectedRunes = false;
                    for (var gf = 0; gf < guest.gifts.length; gf++) {
                        var gift = guest.gifts[gf];
                        if (gift.recipe === recipe.name && selectedRunes.indexOf(gift.antique) >= 0) {
                            hasRecipeForSelectedRunes = true;
                            break;
                        }
                    }
                    
                    if (hasRecipeForSelectedRunes) {
                        if (!recipesByGuest[guest.name]) {
                            recipesByGuest[guest.name] = [];
                        }
                        // 检查是否已添加
                        var alreadyAdded = false;
                        for (var k = 0; k < recipesByGuest[guest.name].length; k++) {
                            if (recipesByGuest[guest.name][k].recipeId === recipe.recipeId) {
                                alreadyAdded = true;
                                break;
                            }
                        }
                        if (!alreadyAdded) {
                            recipesByGuest[guest.name].push(recipe);
                        }
                    }
                }
            }
            
            // 第三步：全局冲突检测（跨符文）
            var noConflictRecipes = {}; // 无冲突菜谱ID集合
            var conflictRecipes = {};   // 冲突菜谱ID集合
            var conflictInfo = {};      // 冲突信息：菜谱ID -> {guestName, conflictWith: [菜谱名列表]}
            
            for (var guestName in recipesByGuest) {
                var guestRecipes = recipesByGuest[guestName];
                
                if (guestRecipes.length === 1) {
                    // 只有一个菜谱，无冲突
                    noConflictRecipes[guestRecipes[0].recipeId] = true;
                } else {
                    // 多个菜谱有冲突，需要选择一个作为无冲突
                    // 双贵客菜谱时间除以2后再判断
                    
                    // 计算每个菜谱的贵客数量和调整后时间
                    var recipesWithAdjustedTime = [];
                    for (var ri = 0; ri < guestRecipes.length; ri++) {
                        var recipe = guestRecipes[ri];
                        var guestCount = getRecipeGuestCount(recipe, gameData);
                        var adjustedTime = (guestCount >= 2) ? (recipe.time / 2) : recipe.time;
                        recipesWithAdjustedTime.push({
                            recipe: recipe,
                            adjustedTime: adjustedTime,
                            guestCount: guestCount
                        });
                        
                        var timeDetail = (guestCount >= 2) 
                            ? recipe.name + ': ' + recipe.time + '秒/2 = ' + Math.floor(adjustedTime) + '秒 (' + guestCount + '贵客)'
                            : recipe.name + ': ' + recipe.time + '秒 (' + guestCount + '贵客)';
                    }
                    
                    // 按调整后的时间排序
                    recipesWithAdjustedTime.sort(function(a, b) {
                        return a.adjustedTime - b.adjustedTime;
                    });
                    
                    // 选择调整后时间最短的作为无冲突菜谱
                    var selectedRecipeInfo = recipesWithAdjustedTime[0];
                    var selectedRecipe = selectedRecipeInfo.recipe;
                    noConflictRecipes[selectedRecipe.recipeId] = true;
                    
                    // 其余菜谱都是冲突菜谱
                    var conflictRecipeNames = [];
                    for (var ci = 1; ci < recipesWithAdjustedTime.length; ci++) {
                        var conflictRecipe = recipesWithAdjustedTime[ci].recipe;
                        conflictRecipes[conflictRecipe.recipeId] = true;
                        conflictRecipeNames.push(conflictRecipe.name);
                        
                        // 记录冲突信息
                        conflictInfo[conflictRecipe.recipeId] = {
                            guestName: guestName,
                            conflictWith: selectedRecipe.name
                        };
                    }
                    
                    var timeInfo = (selectedRecipeInfo.guestCount >= 2)
                        ? '多贵客菜谱(时间' + selectedRecipe.time + '秒/2=' + Math.floor(selectedRecipeInfo.adjustedTime) + '秒)'
                        : '单贵客菜谱(时间' + selectedRecipe.time + '秒)';
                }
            }
            
            // 统计冲突信息
            var noConflictCount = Object.keys(noConflictRecipes).length;
            var conflictCount = Object.keys(conflictRecipes).length;
            
            // 保存冲突信息到结果中
            result.conflictInfo = conflictInfo;
            result.conflictCount = conflictCount;
            
            // 按符文分类菜谱（只使用无冲突菜谱，并过滤掉无法制作的菜谱）
            var recipesByRune = {};
            var cannotMakeRecipes = {}; // 无法制作的菜谱ID集合
            var cannotMakeInfo = {};    // 无法制作信息：菜谱ID -> 菜谱名
            
            for (var r = 0; r < selectedRunes.length; r++) {
                var rune = selectedRunes[r];
                recipesByRune[rune] = [];
                
                // 遍历贵客数据，查找该符文对应的菜谱
                for (var g = 0; g < gameData.guests.length; g++) {
                    var guest = gameData.guests[g];
                    if (!guest.gifts) continue;
                    
                    for (var gf = 0; gf < guest.gifts.length; gf++) {
                        var gift = guest.gifts[gf];
                        if (gift.antique !== rune) continue;
                        
                        var recipe = recipeByName[gift.recipe];
                        if (!recipe) continue;
                        if (onlyShowOwned && recipe.got !== "是") continue;
                        
                        // 跳过冲突菜谱
                        if (conflictRecipes[recipe.recipeId]) {
                            continue;
                        }
                        
                        // 检查是否有厨师能制作该菜谱（使用带厨具加成的厨师数据）
                        var canMake = false;
                        var canMakeChefName = '';
                        for (var c = 0; c < enhancedChefs.length; c++) {
                            // 使用带厨具加成的厨师数据检查，与第二阶段计算的技法值一致
                            var enhancedChef = enhancedChefs[c].enhanced;
                            var rank = getRecipeRank(enhancedChef, recipe);
                            if (rank > 0) {
                                canMake = true;
                                canMakeChefName = enhancedChef.name;
                                break;
                            }
                        }
                        
                        // 跳过无法制作的菜谱
                        if (!canMake) {
                            if (!cannotMakeRecipes[recipe.recipeId]) {
                                cannotMakeRecipes[recipe.recipeId] = true;
                                cannotMakeInfo[recipe.recipeId] = recipe.name;
                            }
                            continue;
                        } else {
                        }
                        
                        // 检查是否已经添加过该菜谱
                        var alreadyAdded = false;
                        for (var k = 0; k < recipesByRune[rune].length; k++) {
                            if (recipesByRune[rune][k].recipeId === recipe.recipeId) {
                                alreadyAdded = true;
                                break;
                            }
                        }
                        if (!alreadyAdded) {
                            recipesByRune[rune].push(recipe);
                        }
                    }
                }
                
            }

            // 保存无法制作信息到结果中
            var cannotMakeCount = Object.keys(cannotMakeRecipes).length;
            if (cannotMakeCount > 0) {
                result.cannotMakeInfo = cannotMakeInfo;
                result.cannotMakeCount = cannotMakeCount;
            }
            
            // ========================================
            // 按轮次分配菜谱（与show项目一致）
            // 每轮每个符文分配一个最高评分的菜谱
            // ========================================
            var timeLimitSeconds = settings.defaultTime * 3600;
            var totalCookingTime = 0;
            var round = 0;
            var maxRounds = 100;
            var continueAllocation = true;
            var singleRecipePerRune = settings.singleRecipePerRune === true;
            
            
            while (continueAllocation && round < maxRounds) {
                round++;

                var assignedThisRound = false;
                var assignedRunes = {}; // 记录本轮已分配的符文

                while (continueAllocation) {
                    var bestRoundItem = null;

                    // 每次分配后都为剩余符文实时重算最优候选，避免候选过期
                    for (var r = 0; r < selectedRunes.length; r++) {
                        var rune = selectedRunes[r];
                        if (assignedRunes[rune]) continue;

                        var candidate = findBestRecipeAssignmentForRune(
                            rune,
                            recipesByRune[rune] || [],
                            enhancedChefs,
                            usedRecipeIds,
                            gameData
                        );

                        if (!candidate) continue;

                        if (!bestRoundItem || candidate.score > bestRoundItem.score) {
                            bestRoundItem = candidate;
                        }
                    }

                    // 本轮没有任何可继续分配的候选
                    if (!bestRoundItem) {
                        break;
                    }

                    enhancedChefs[bestRoundItem.bestChefIndex].recipes.push({
                        recipe: bestRoundItem.recipe,
                        rank: bestRoundItem.bestRank,
                        rune: bestRoundItem.rune
                    });
                    usedRecipeIds[bestRoundItem.recipe.recipeId] = true;
                    assignedRunes[bestRoundItem.rune] = true;

                    if (bestRoundItem.bestRank >= 4) totalGodCount++;

                    // 计算制作时间
                    // 如果必来份数超过最大份数，使用最大份数计算时间
                    var quantityResult = calculateRecipeQuantity(bestRoundItem.recipe, totalGuestRate, false);
                    var actualQuantityForTime = quantityResult.canAchieveBilai ? quantityResult.quantity : quantityResult.maxQuantity;
                    var cookingTime = calculateCookingTime(bestRoundItem.recipe.time || 0, actualQuantityForTime, totalTimeBonus);
                    totalCookingTime += cookingTime;

                    var guestInfo = (bestRoundItem.guestCount >= 2) ? ' (' + bestRoundItem.guestCount + '贵客)' : '';

                    assignedThisRound = true;

                    // 检查时间是否达标
                    if (totalCookingTime >= timeLimitSeconds) {
                        continueAllocation = false;
                        break;
                    }
                }
                
                // 如果本轮没有分配任何菜谱，停止
                if (!assignedThisRound) {
                    continueAllocation = false;
                }
                
                // 检查是否所有厨师都已满
                var allChefsFull = true;
                for (var c = 0; c < enhancedChefs.length; c++) {
                    if (enhancedChefs[c].recipes.length < 3) {
                        allChefsFull = false;
                        break;
                    }
                }
                if (allChefsFull) {
                    continueAllocation = false;
                }

                if (singleRecipePerRune) {
                    continueAllocation = false;
                }
            }

            supplementPerRankChefRecipesInPlace(
                enhancedChefs,
                recipes,
                onlyShowOwned
            );
            
            
            // 构建结果（重新计算份数和制作时间）
            var positions = [];
            var totalRecipes = 0;
            totalCookingTime = 0; // 重新计算
            var runeFinalSelections = [];
            
            
            // 收集无法达到必来的星级和菜谱名称
            var cannotAchieveStarLevels = {};
            var cannotAchieveRecipes = []; // 无法必来的菜谱名称列表
            
            for (var i = 0; i < enhancedChefs.length; i++) {
                var chefData = enhancedChefs[i];
                var chefRecipes = [];
                var chefRecipeDetails = [];
                var godCount = 0;
                var chefCookingTime = 0;
                
                for (var j = 0; j < chefData.recipes.length; j++) {
                    var recipeData = chefData.recipes[j];
                    var recipe = recipeData.recipe;
                    
                    var isFullPoolSupplement = recipeData.isFullPoolSupplement === true;
                    var quantityResult;
                    var quantity;
                    var quantityForTime;

                    if (isFullPoolSupplement) {
                        quantityResult = {
                            quantity: 1,
                            canAchieveBilai: true,
                            requiredPortions: 1,
                            maxQuantity: 1
                        };
                        quantity = 1;
                        quantityForTime = 1;
                    } else {
                        // 计算份数
                        quantityResult = calculateRecipeQuantity(recipe, totalGuestRate, false);
                        // 页面设置用必来份数（让用户知道需要多少份才能必来）
                        quantity = quantityResult.quantity;
                        // 计算时间用实际可做份数（无法必来时使用最大份数）
                        quantityForTime = quantityResult.canAchieveBilai ? quantityResult.quantity : quantityResult.maxQuantity;
                    }
                    
                    // 记录无法达到必来的星级和菜谱名称
                    if (!isFullPoolSupplement && !quantityResult.canAchieveBilai) {
                        var starLevel = recipe.rarity || 5;
                        cannotAchieveStarLevels[starLevel] = true;
                        cannotAchieveRecipes.push(recipe.name);
                    }
                    
                    // 计算制作时间（使用实际可做份数）
                    var cookingTime = calculateCookingTime(recipe.time || 0, quantityForTime, totalTimeBonus);
                    
                    chefRecipes.push(recipe);
                    chefRecipeDetails.push({
                        recipe: recipe,
                        rank: recipeData.rank,
                        rune: recipeData.rune,
                        quantity: quantity, // 页面设置用必来份数
                        cookingTime: cookingTime,
                        canAchieveBilai: quantityResult.canAchieveBilai,
                        isFullPoolSupplement: isFullPoolSupplement
                    });

                    runeFinalSelections.push({
                        rank: recipeData.rank,
                        isFullPoolSupplement: isFullPoolSupplement
                    });
                    
                    if (recipeData.rank >= 4) godCount++;
                    chefCookingTime += cookingTime;
                }
                
                // 使用原始位置信息构建position对象
                var positionData = {
                    type: 'target',
                    chef: chefData.original,
                    recipes: chefRecipes,
                    recipeDetails: chefRecipeDetails,
                    godCount: godCount,
                    cookingTime: chefCookingTime,
                    auraBonus: getTotalSkillBonus(chefData.auraBonus) > 0 ? chefData.auraBonus : null,
                    originalPosition: chefData.originalPosition // 保存原始位置
                };
                positions.push(positionData);
                
                result.recipes = result.recipes.concat(chefRecipes);
                totalRecipes += chefRecipes.length;
                totalCookingTime += chefCookingTime;
            }
            
            // 如果使用场上已有厨师，需要按原始位置重新排列positions数组
            // 确保菜谱设置到正确的位置
            if (useExistingChefs && positions.length > 0) {
                var sortedPositions = [];
                // 创建3个空位置
                for (var p = 0; p < 3; p++) {
                    sortedPositions.push({
                        type: 'empty',
                        chef: null,
                        recipes: [],
                        recipeDetails: [],
                        godCount: 0,
                        cookingTime: 0,
                        auraBonus: null,
                        originalPosition: p
                    });
                }
                // 将厨师放到正确的位置
                for (var p = 0; p < positions.length; p++) {
                    var pos = positions[p];
                    var origPos = pos.originalPosition;
                    if (origPos !== undefined && origPos >= 0 && origPos < 3) {
                        sortedPositions[origPos] = pos;
                    }
                }
                positions = sortedPositions;
            }
            
            // 检查时间是否达标
            var timeReached = totalCookingTime >= timeLimitSeconds;
            var totalHours = (totalCookingTime / 3600).toFixed(1);
            
            result.positions = positions;
            result.totalGuestRate = totalGuestRate;
            result.totalTimeBonus = totalTimeBonus;
            result.totalCookingTime = totalCookingTime;
            result.timeReached = timeReached;
            result.qualityLevel = getAverageQualityLevelFromSelections(runeFinalSelections);
            
            // 记录无法达到必来的星级列表
            var cannotAchieveStarList = Object.keys(cannotAchieveStarLevels).map(Number).sort();
            if (cannotAchieveStarList.length > 0) {
                result.cannotAchieveStarLevels = cannotAchieveStarList;
            }
            
            // 记录无法达到必来的菜谱名称列表
            if (cannotAchieveRecipes.length > 0) {
                result.cannotAchieveRecipes = cannotAchieveRecipes;
            }
            
            // 标记是否无法达到必来
            if (bestGroupStats && bestGroupStats.cannotAchieveBilai) {
                result.cannotAchieveBilai = true;
            }
            
            // 计算应该使用的星级和份数（用于设置星级和份数输入框）
            var isQueryEfficiencyMode = settings.queryMode;
            var calculatedStarLevel = 5; // 默认5星
            var calculatedQuantity = 7; // 默认7份
            
            if (bestGroupStats) {
                // 使用组合统计中保存的星级
                calculatedStarLevel = bestGroupStats.calcStarLevel || 5;
                // 份数：如果无法必来，使用必来份数；否则使用计算份数
                if (!isQueryEfficiencyMode && !bestGroupStats.canAchieveBilai && bestGroupStats.requiredPortions) {
                    // 无法必来时，设置必来份数（让用户知道需要多少份才能必来）
                    calculatedQuantity = bestGroupStats.requiredPortions;
                } else {
                    calculatedQuantity = bestGroupStats.calcQuantity || 7;
                }
            }
            result.calculatedStarLevel = calculatedStarLevel;
            result.calculatedQuantity = calculatedQuantity;
            
            result.success = true;
            
            // 构建结果消息
            var messageText = '一键查询完成（' + totalGodCount + '/' + totalRecipes + '达神，' + 
                            totalHours + '/' + settings.defaultTime + '小时' + 
                            (timeReached ? '✓' : '✗') + '）';
            if (result.cannotAchieveBilai) {
                messageText += ' [无法必来]';
            }
            
            // 添加冲突和无法制作的提示
            var warningParts = [];
            if (result.conflictCount > 0) {
                warningParts.push('冲突菜谱' + result.conflictCount + '个');
            }
            if (result.cannotMakeCount > 0) {
                warningParts.push('无法制作' + result.cannotMakeCount + '个');
            }
            if (warningParts.length > 0) {
                messageText += ' [已排除: ' + warningParts.join('，') + ']';
            }
            
            result.message = messageText;
            
            
            return result;
            
        } catch (e) {
            console.error('一键查询出错:', e);
            return {
                success: false,
                chefs: [],
                recipes: [],
                message: '查询出错: ' + e.message
            };
        } finally {
            isQueryInProgress = false;
        }
    }

    // ========================================
    // 查询设置弹窗
    // ========================================
    
    /**
     * 显示查询设置弹窗
     */
    function showSettingsDialog() {
        loadSettings();
        
        var html = createSettingsDialogHtml();
        $('#oneclick-settings-modal').remove();
        $('body').append(html);
        initSettingsDialogControls();
        $('#oneclick-settings-modal').modal('show');
    }
    
    /**
     * 创建查询设置弹窗HTML
     */
    function createSettingsDialogHtml() {
        var isJadeMode = $("#chk-guest-rate-submode").prop("checked");
        var referenceButtonText = isJadeMode ? '金符文效率排行表' : '贵客必来对照表';
        var html = '<div class="modal fade" id="oneclick-settings-modal" tabindex="-1">';
        html += '<div class="modal-dialog modal-lg">';
        html += '<div class="modal-content">';
        
        // 弹窗头部
        html += '<div class="modal-header settings-modal-header">';
        html += '<button type="button" class="close" data-dismiss="modal">&times;</button>';
        html += '<h4 class="modal-title">查询设置</h4>';
        html += '<button type="button" class="btn btn-primary btn-sm" id="btn-query-reference-table">' + referenceButtonText + '</button>';
        html += '</div>';
        
        // 弹窗内容
        html += '<div class="modal-body">';
        
        // 设置选项行1：制作时间和查询模式
        html += '<div class="row settings-row">';
        html += '<div class="col-xs-6">';
        html += '<div class="setting-card">';
        html += '<label>开业时间</label>';
        html += '<div class="input-group input-group-sm">';
        html += '<input type="number" class="form-control" id="setting-defaultTime" value="' + settings.defaultTime + '" min="0" max="24" step="0.1">';
        html += '<span class="input-group-addon">小时</span>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '<div class="col-xs-6">';
        html += '<div class="setting-card">';
        html += '<label id="queryModeLabel">' + (settings.queryMode ? '查询效率' : '查询必来') + '</label>';
        html += '<div class="switch-container">';
        html += '<input type="checkbox" id="setting-queryMode"' + (settings.queryMode ? ' checked' : '') + '>';
        html += '<label for="setting-queryMode" class="switch-label"></label>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        
        // 设置选项行2：使用场上已有配置 + 每种符文分配方式
        html += '<div class="row settings-row">';
        html += '<div class="col-xs-6">';
        html += '<div class="setting-card">';
        html += '<label>使用场上已有配置</label>';
        html += '<div class="switch-container">';
        html += '<input type="checkbox" id="setting-useExistingConfig"' + (settings.useExistingConfig ? ' checked' : '') + '>';
        html += '<label for="setting-useExistingConfig" class="switch-label"></label>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '<div class="col-xs-6">';
        html += '<div class="setting-card">';
        html += '<label id="singleRecipePerRuneLabel">' + (settings.singleRecipePerRune ? '每种符文只查一个菜谱' : '每种符文平均分配') + '</label>';
        html += '<div class="switch-container">';
        html += '<input type="checkbox" id="setting-singleRecipePerRune"' + (settings.singleRecipePerRune ? ' checked' : '') + '>';
        html += '<label for="setting-singleRecipePerRune" class="switch-label"></label>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        
        // 符文选择区域
        html += createRuneSelectionSection('gold', '金符文', GOLD_RUNES, settings.goldRuneSelections, settings.goldRuneExpanded);
        if (!isJadeMode) {
            html += createRuneSelectionSection('silver', '银符文', SILVER_RUNES, settings.silverRuneSelections, settings.silverRuneExpanded);
            html += createRuneSelectionSection('bronze', '铜符文', BRONZE_RUNES, settings.bronzeRuneSelections, settings.bronzeRuneExpanded);
        }
        
        html += '</div>';
        
        // 弹窗底部
        html += '<div class="modal-footer">';
        html += '<button type="button" class="btn btn-default" data-dismiss="modal">关闭</button>';
        html += '</div>';
        
        html += '</div></div></div>';
        
        return html;
    }

    function getJadeRankingRuneColumnIndex(tableData) {
        if (!tableData || !Array.isArray(tableData.headers)) {
            return -1;
        }
        return tableData.headers.indexOf('符文');
    }

    function getJadeRankingAvailableRunes(tableData) {
        var runeColumnIndex = getJadeRankingRuneColumnIndex(tableData);
        var rows = tableData && Array.isArray(tableData.rows) ? tableData.rows : [];
        var runes = [];
        var runeMap = {};
        var i;
        var runeValue;

        if (runeColumnIndex < 0) {
            return runes;
        }

        for (i = 0; i < rows.length; i++) {
            runeValue = rows[i] && rows[i].length > runeColumnIndex ? String(rows[i][runeColumnIndex]).trim() : '';
            if (!runeValue || runeMap[runeValue]) {
                continue;
            }
            runeMap[runeValue] = true;
            runes.push(runeValue);
        }

        return runes;
    }

    function getJadeRankingSelectedRunes() {
        var $filter = $('#jade-ranking-rune-filter');
        if (!$filter.length) {
            return [];
        }

        var value = $filter.val();
        if (!Array.isArray(value)) {
            return value ? [value] : [];
        }
        return value.slice();
    }

    function createJadeRankingRuneFilterHtml(tableData) {
        var availableRunes = getJadeRankingAvailableRunes(tableData);
        if (!availableRunes.length) {
            return '';
        }

        var html = '<div class="jade-ranking-filter-wrapper">';
        html += '<select id="jade-ranking-rune-filter" class="selectpicker" multiple';
        html += ' data-width="96px" data-size="6" data-actions-box="true"';
        html += ' data-select-all-text="全选" data-deselect-all-text="清空"';
        html += ' data-none-selected-text="全部符文" data-selected-text-format="count > 1"';
        html += ' data-count-selected-text="已选{0}种" data-multiple-separator="、"';
        html += ' title="全部符文">';
        for (var i = 0; i < availableRunes.length; i++) {
            html += '<option value="' + escapeHtml(availableRunes[i]) + '" selected>' + escapeHtml(availableRunes[i]) + '</option>';
        }
        html += '</select>';
        html += '</div>';
        return html;
    }

    function createJadeRankingTableRowsHtml(tableData, selectedRunes) {
        if (!tableData || !tableData.rows || !tableData.rows.length) {
            return '<tr><td colspan="1" class="jade-ranking-empty-cell">暂无数据</td></tr>';
        }

        var runeColumnIndex = getJadeRankingRuneColumnIndex(tableData);
        var runeFilterMap = {};
        var hasRuneFilter = Array.isArray(selectedRunes) && selectedRunes.length > 0;
        var visibleRows = [];
        var html = '';
        var colSpan = tableData.headers && tableData.headers.length ? tableData.headers.length : 1;
        var i;

        if (hasRuneFilter) {
            for (i = 0; i < selectedRunes.length; i++) {
                runeFilterMap[selectedRunes[i]] = true;
            }
        }

        for (i = 0; i < tableData.rows.length; i++) {
            var row = tableData.rows[i];
            var rowRune = runeColumnIndex >= 0 ? row[runeColumnIndex] : '';
            if (hasRuneFilter && !runeFilterMap[rowRune]) {
                continue;
            }
            visibleRows.push(row);
        }

        if (!visibleRows.length) {
            return '<tr><td colspan="' + colSpan + '" class="jade-ranking-empty-cell">当前筛选无数据</td></tr>';
        }

        for (i = 0; i < visibleRows.length; i++) {
            html += '<tr>';
            for (var c = 0; c < visibleRows[i].length; c++) {
                html += '<td>' + escapeHtml(visibleRows[i][c]) + '</td>';
            }
            html += '</tr>';
        }

        return html;
    }

    function createJadeRankingTableContentHtml(tableData, errorMessage, selectedRunes) {
        if (errorMessage) {
            return '<div class="jade-ranking-loading jade-ranking-error">' + escapeHtml(errorMessage) + '</div>';
        }

        if (!tableData || !tableData.headers || !tableData.rows) {
            return '<div class="jade-ranking-loading jade-ranking-error">加载失败</div>';
        }

        var title = escapeHtml(tableData.title || '金符文效率排行表');
        var html = '<div class="jade-ranking-table-container">';
        html += '<div class="jade-ranking-sheet">';
        html += '<table class="table table-bordered jade-ranking-table">';
        html += '<thead>';
        html += '<tr class="jade-ranking-title-row"><th colspan="' + tableData.headers.length + '">' + title + '</th></tr>';
        html += '<tr class="jade-ranking-header-row">';
        for (var i = 0; i < tableData.headers.length; i++) {
            html += '<th>' + escapeHtml(tableData.headers[i]) + '</th>';
        }
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>' + createJadeRankingTableRowsHtml(tableData, selectedRunes) + '</tbody>';
        html += '</table>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderJadeRankingTableRows(tableData) {
        var $tbody = $('#jade-ranking-table-modal .jade-ranking-table tbody');
        if (!$tbody.length || !tableData || !tableData.headers || !tableData.rows) {
            return;
        }
        $tbody.html(createJadeRankingTableRowsHtml(tableData, getJadeRankingSelectedRunes()));
    }

    function initJadeRankingRuneFilter(tableData) {
        var $filter = $('#jade-ranking-rune-filter');
        if (!$filter.length || !tableData || !tableData.rows || !tableData.rows.length) {
            return;
        }

        if ($.fn.selectpicker) {
            $filter.selectpicker();
        }

        $filter.off('.jadeRankingFilter')
            .on('changed.bs.select.jadeRankingFilter change.jadeRankingFilter', function() {
                renderJadeRankingTableRows(tableData);
                scheduleJadeRankingModalWidthUpdate();
            });
    }

    function openJadeRankingTableDialog(tableData, errorMessage) {
        $('#jade-ranking-table-modal').remove();

        var html = '<div class="modal fade" id="jade-ranking-table-modal" tabindex="-1">';
        html += '<div class="modal-dialog">';
        html += '<div class="modal-content">';
        html += '<div class="modal-header jade-ranking-modal-header">';
        html += '<div class="jade-ranking-modal-header-main">';
        html += '<h4 class="modal-title">金符文效率排行表</h4>';
        html += createJadeRankingRuneFilterHtml(tableData);
        html += '<button type="button" class="close jade-ranking-close" data-dismiss="modal">&times;</button>';
        html += '</div>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += createJadeRankingTableContentHtml(tableData, errorMessage, getJadeRankingAvailableRunes(tableData));
        html += '</div>';
        html += '<div class="modal-footer">';
        html += '<button type="button" class="btn btn-default" data-dismiss="modal">关闭</button>';
        html += '</div>';
        html += '</div></div></div>';

        $('body').append(html);
        initJadeRankingRuneFilter(tableData);
        prepareJadeRankingModalWidth();
        $('#jade-ranking-table-modal')
            .off('shown.bs.modal.jadeRankingLayout')
            .on('shown.bs.modal.jadeRankingLayout', function() {
                scheduleJadeRankingModalWidthUpdate();
                enableDragScrollForJadeRanking();
            })
            .modal('show');
    }

    function showJadeRankingTableDialog() {
        if (jadeRankingTableDataCache) {
            openJadeRankingTableDialog(jadeRankingTableDataCache);
            return;
        }

        preloadJadeRankingTableData(false, function(response, error) {
            if (error || !response) {
                openJadeRankingTableDialog(null, '加载失败');
                return;
            }
            openJadeRankingTableDialog(response);
        });
    }

    function prepareJadeRankingModalWidth() {
        var $modal = $('#jade-ranking-table-modal');
        if (!$modal.length) {
            return;
        }

        $modal.css({
            display: 'block',
            visibility: 'hidden',
            pointerEvents: 'none'
        });

        updateJadeRankingModalWidth();

        $modal.css({
            display: '',
            visibility: '',
            pointerEvents: ''
        });
    }

    function scheduleJadeRankingModalWidthUpdate(done) {
        var attempt = 0;

        function runUpdate() {
            updateJadeRankingModalWidth();
            attempt++;
            if (attempt < 3) {
                setTimeout(runUpdate, 60);
            } else if (typeof done === 'function') {
                done();
            }
        }

        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(function() {
                window.requestAnimationFrame(runUpdate);
            });
            return;
        }

        setTimeout(runUpdate, 0);
    }

    function updateJadeRankingModalWidth() {
        var $modal = $('#jade-ranking-table-modal');
        var $dialog = $modal.find('.modal-dialog');
        var $body = $modal.find('.modal-body');
        var $header = $modal.find('.modal-header');
        var $table = $modal.find('.jade-ranking-table');
        if (!$dialog.length) {
            return;
        }

        if (!$table.length) {
            $dialog.css('width', '');
            return;
        }

        var viewportWidth = Math.max($(window).width() || 0, window.innerWidth || 0);
        if (!viewportWidth) {
            $dialog.css('width', '');
            return;
        }

        var isMobileViewport = viewportWidth <= 768;
        var bodyPaddingLeft = parseFloat($body.css('padding-left')) || 0;
        var bodyPaddingRight = parseFloat($body.css('padding-right')) || 0;
        var bodyHorizontalPadding = bodyPaddingLeft + bodyPaddingRight;
        var bodyElement = $body.get(0);
        var bodyScrollbarWidth = 0;
        if (bodyElement) {
            bodyScrollbarWidth = Math.max(0, bodyElement.offsetWidth - bodyElement.clientWidth);
        }
        var tableElement = $table.get(0);
        var tableWidth = Math.ceil((tableElement && tableElement.scrollWidth) || $table.outerWidth() || 0);
        var headerElement = $header.get(0);
        var headerWidth = Math.ceil((headerElement && headerElement.scrollWidth) || $header.outerWidth() || 0);
        var targetWidth = Math.max(tableWidth + bodyHorizontalPadding + bodyScrollbarWidth + 2, headerWidth + 2);
        var fallbackWidth = Math.max(280, viewportWidth - 20);

        if (isMobileViewport) {
            var sideGap = 10;
            var maxDialogWidth = Math.max(280, viewportWidth - sideGap * 2);
            if (targetWidth > maxDialogWidth) {
                targetWidth = maxDialogWidth;
            }
        }

        if (targetWidth <= 0) {
            targetWidth = fallbackWidth;
        }

        $dialog.css('width', targetWidth + 'px');
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) {
            return '';
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function enableDragScrollForJadeRanking() {
        var $body = $('#jade-ranking-table-modal .modal-body');
        var $container = $('#jade-ranking-table-modal .jade-ranking-table-container');
        var viewportWidth = Math.max($(window).width() || 0, window.innerWidth || 0);
        if (!$body.length || !$container.length) {
            return;
        }

        if (viewportWidth > 768) {
            return;
        }

        var body = $body.get(0);
        var container = $container.get(0);
        if (!body || !container || body.__jadeDragScrollBound) {
            return;
        }

        body.__jadeDragScrollBound = true;
        $container.addClass('jade-ranking-draggable');

        var state = {
            active: false,
            startX: 0,
            startY: 0,
            scrollLeft: 0,
            scrollTop: 0
        };

        function getPoint(event) {
            if (event.touches && event.touches.length) {
                return event.touches[0];
            }
            if (event.changedTouches && event.changedTouches.length) {
                return event.changedTouches[0];
            }
            return event;
        }

        function start(event) {
            var point = getPoint(event);
            state.active = true;
            state.startX = point.clientX;
            state.startY = point.clientY;
            state.scrollLeft = container.scrollLeft;
            state.scrollTop = body.scrollTop;
            $container.addClass('drag-scrolling');
        }

        function move(event) {
            if (!state.active) {
                return;
            }

            var point = getPoint(event);
            var deltaX = point.clientX - state.startX;
            var deltaY = point.clientY - state.startY;
            container.scrollLeft = state.scrollLeft - deltaX;
            body.scrollTop = state.scrollTop - deltaY;

            if (event.cancelable) {
                event.preventDefault();
            }
        }

        function end() {
            state.active = false;
            $container.removeClass('drag-scrolling');
        }

        body.addEventListener('touchstart', start, { passive: true });
        body.addEventListener('touchmove', move, { passive: false });
        body.addEventListener('touchend', end);
        body.addEventListener('touchcancel', end);
        body.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
    }

    /**
     * 创建开关卡片HTML
     */
    function createSwitchCard(id, label, checked) {
        var html = '<div class="col-xs-6">';
        html += '<div class="setting-card">';
        html += '<label>' + label + '</label>';
        html += '<div class="switch-container">';
        html += '<input type="checkbox" id="setting-' + id + '"' + (checked ? ' checked' : '') + '>';
        html += '<label for="setting-' + id + '" class="switch-label"></label>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        return html;
    }
    
    /**
     * 创建符文选择区域HTML
     */
    function createRuneSelectionSection(type, title, runes, selections, expanded) {
        selections = selections || [];
        
        var html = '<div class="rune-section" data-type="' + type + '">';
        html += '<div class="rune-header" data-toggle="collapse" data-target="#rune-' + type + '-content">';
        html += '<span class="rune-title">' + title + '</span>';
        html += '<span class="rune-count">(' + selections.length + '/' + runes.length + ')</span>';
        html += '<span class="glyphicon glyphicon-chevron-' + (expanded ? 'up' : 'down') + '"></span>';
        html += '</div>';
        html += '<div id="rune-' + type + '-content" class="collapse' + (expanded ? ' in' : '') + '">';
        html += '<div class="rune-list">';
        
        for (var i = 0; i < runes.length; i++) {
            var rune = runes[i];
            var isSelected = selections.indexOf(rune) >= 0;
            html += '<div class="rune-item' + (isSelected ? ' selected' : '') + '" data-rune="' + rune + '">';
            html += '<span class="rune-name">' + rune + '</span>';
            html += '<span class="glyphicon glyphicon-' + (isSelected ? 'check' : 'unchecked') + '"></span>';
            html += '</div>';
        }
        
        html += '</div></div></div>';
        return html;
    }

    /**
     * 初始化查询设置弹窗控件
     */
    function initSettingsDialogControls() {
        var $modal = $('#oneclick-settings-modal');
        
        // 开关控件事件
        $modal.find('input[type="checkbox"]').on('change', function() {
            var $input = $(this);
            var id = $input.attr('id').replace('setting-', '');
            var checked = $input.is(':checked');
            
            setSetting(id, checked);
            
            if (id === 'queryMode') {
                $('#queryModeLabel').text(checked ? '查询效率' : '查询必来');
            } else if (id === 'singleRecipePerRune') {
                $('#singleRecipePerRuneLabel').text(checked ? '每种符文只查一个菜谱' : '每种符文平均分配');
            }
        });
        
        // 制作时间输入事件
        $modal.find('#setting-defaultTime').on('input', function() {
            var val = $(this).val();
            // 限制只能输入一位小数：如果小数点后超过1位，截断
            if (val.indexOf('.') !== -1 && val.split('.')[1].length > 1) {
                $(this).val(val.substring(0, val.indexOf('.') + 2));
            }
        }).on('change', function() {
            var value = parseFloat($(this).val()) || 7.0;
            if (value < 0) value = 0;
            if (value > 24) value = 24;
            $(this).val(value);
            setSetting('defaultTime', value);
        });
        
        // 符文选择事件
        $modal.find('.rune-item').on('click', function() {
            var $item = $(this);
            var rune = $item.data('rune');
            var type = $item.closest('.rune-section').data('type');
            var settingKey = type + 'RuneSelections';
            
            var selections = settings[settingKey] || [];
            var index = selections.indexOf(rune);
            
            if (index >= 0) {
                selections.splice(index, 1);
                $item.removeClass('selected');
                $item.find('.glyphicon').removeClass('glyphicon-check').addClass('glyphicon-unchecked');
            } else {
                selections.push(rune);
                $item.addClass('selected');
                $item.find('.glyphicon').removeClass('glyphicon-unchecked').addClass('glyphicon-check');
            }
            
            setSetting(settingKey, selections);
            
            var $section = $item.closest('.rune-section');
            var total = $section.find('.rune-item').length;
            $section.find('.rune-count').text('(' + selections.length + '/' + total + ')');
        });
        
        // 符文区域展开/收起事件
        $modal.find('.rune-header').on('click', function() {
            var $header = $(this);
            var type = $header.closest('.rune-section').data('type');
            var $icon = $header.find('.glyphicon');
            var settingKey = type + 'RuneExpanded';
            
            if ($icon.hasClass('glyphicon-chevron-down')) {
                $icon.removeClass('glyphicon-chevron-down').addClass('glyphicon-chevron-up');
                setSetting(settingKey, true);
            } else {
                $icon.removeClass('glyphicon-chevron-up').addClass('glyphicon-chevron-down');
                setSetting(settingKey, false);
            }
        });
        
        // 贵客必来对照表按钮点击事件
        $modal.find('#btn-query-reference-table').on('click', function() {
            if ($("#chk-guest-rate-submode").prop("checked")) {
                showJadeRankingTableDialog();
            } else {
                showGuestPortionTableDialog();
            }
        });
    }
    
    /**
     * 显示贵客必来对照表弹窗
     */
    function showGuestPortionTableDialog() {
        // 如果弹窗已存在，先移除
        $('#guest-portion-table-modal').remove();
        
        // 贵客率-份数对照表数据（完整的1-5星菜谱数据）
        var guestPortionTable = {
            80: {1: 59, 2: 39, 3: 42, 4: 91, 5: 62},
            90: {1: 57, 2: 38, 3: 40, 4: 86, 5: 59},
            100: {1: 55, 2: 36, 3: 39, 4: 81, 5: 56},
            110: {1: 53, 2: 35, 3: 37, 4: 77, 5: 53},
            120: {1: 52, 2: 34, 3: 36, 4: 73, 5: 50},
            130: {1: 50, 2: 33, 3: 34, 4: 69, 5: 48},
            140: {1: 49, 2: 32, 3: 33, 4: 66, 5: 46},
            150: {1: 47, 2: 31, 3: 32, 4: 63, 5: 44},
            160: {1: 46, 2: 31, 3: 31, 4: 60, 5: 42},
            170: {1: 45, 2: 30, 3: 30, 4: 57, 5: 40},
            180: {1: 44, 2: 29, 3: 30, 4: 55, 5: 38},
            190: {1: 43, 2: 29, 3: 29, 4: 52, 5: 37},
            200: {1: 42, 2: 28, 3: 28, 4: 50, 5: 36},
            210: {1: 41, 2: 28, 3: 27, 4: 48, 5: 34},
            220: {1: 41, 2: 27, 3: 27, 4: 46, 5: 33},
            230: {1: 40, 2: 27, 3: 26, 4: 45, 5: 32},
            240: {1: 39, 2: 26, 3: 26, 4: 43, 5: 31},
            250: {1: 39, 2: 26, 3: 25, 4: 41, 5: 30},
            260: {1: 38, 2: 25, 3: 25, 4: 40, 5: 29},
            270: {1: 37, 2: 25, 3: 24, 4: 39, 5: 28},
            280: {1: 37, 2: 25, 3: 24, 4: 37, 5: 27},
            290: {1: 36, 2: 24, 3: 23, 4: 36, 5: 26},
            300: {1: 36, 2: 24, 3: 23, 4: 35, 5: 25},
            310: {1: 35, 2: 24, 3: 23, 4: 34, 5: 25},
            320: {1: 35, 2: 23, 3: 22, 4: 33, 5: 24},
            330: {1: 35, 2: 23, 3: 22, 4: 32, 5: 23},
            340: {1: 34, 2: 23, 3: 22, 4: 31, 5: 23},
            350: {1: 34, 2: 23, 3: 21, 4: 30, 5: 22},
            360: {1: 33, 2: 22, 3: 21, 4: 29, 5: 22},
            370: {1: 33, 2: 22, 3: 21, 4: 28, 5: 21},
            380: {1: 33, 2: 22, 3: 20, 4: 27, 5: 20},
            390: {1: 32, 2: 22, 3: 20, 4: 26, 5: 20},
            400: {1: 32, 2: 21, 3: 20, 4: 26, 5: 19},
            410: {1: 32, 2: 21, 3: 20, 4: 25, 5: 19},
            420: {1: 31, 2: 21, 3: 19, 4: 24, 5: 18},
            430: {1: 31, 2: 21, 3: 19, 4: 23, 5: 18},
            440: {1: 31, 2: 21, 3: 19, 4: 23, 5: 18},
            450: {1: 31, 2: 21, 3: 19, 4: 22, 5: 17},
            460: {1: 30, 2: 20, 3: 18, 4: 22, 5: 17},
            470: {1: 30, 2: 20, 3: 18, 4: 21, 5: 16},
            480: {1: 30, 2: 20, 3: 18, 4: 20, 5: 16},
            490: {1: 30, 2: 20, 3: 18, 4: 20, 5: 16},
            500: {1: 29, 2: 20, 3: 18, 4: 19, 5: 15},
            510: {1: 29, 2: 20, 3: 18, 4: 19, 5: 15},
            520: {1: 29, 2: 20, 3: 17, 4: 18, 5: 15},
            530: {1: 29, 2: 19, 3: 17, 4: 18, 5: 14},
            540: {1: 29, 2: 19, 3: 17, 4: 17, 5: 14}
        };
        
        // 保底份数
        var guaranteedPortions = {5: 7, 4: 10, 3: 12, 2: 15, 1: 20};
        
        // 创建弹窗HTML
        var html = '<div class="modal fade" id="guest-portion-table-modal" tabindex="-1">';
        html += '<div class="modal-dialog">';
        html += '<div class="modal-content">';
        
        // 弹窗头部
        html += '<div class="modal-header">';
        html += '<button type="button" class="close" data-dismiss="modal">&times;</button>';
        html += '<h4 class="modal-title">贵客必来份数对照表</h4>';
        html += '</div>';
        
        // 弹窗内容
        html += '<div class="modal-body">';
        html += '<div class="guest-portion-table-container">';
        html += '<table class="table table-bordered table-condensed guest-portion-table">';
        
        // 表头
        html += '<thead>';
        html += '<tr class="table-header">';
        html += '<th>贵客率</th>';
        html += '<th>5星</th>';
        html += '<th>4星</th>';
        html += '<th>3星</th>';
        html += '<th>2星</th>';
        html += '<th>1星</th>';
        html += '</tr>';
        html += '</thead>';
        
        html += '<tbody>';
        
        // 保底份数行
        html += '<tr class="guaranteed-row">';
        html += '<td class="rate-cell">保底份数</td>';
        html += '<td class="portion-cell">' + guaranteedPortions[5] + '</td>';
        html += '<td class="portion-cell">' + guaranteedPortions[4] + '</td>';
        html += '<td class="portion-cell">' + guaranteedPortions[3] + '</td>';
        html += '<td class="portion-cell">' + guaranteedPortions[2] + '</td>';
        html += '<td class="portion-cell">' + guaranteedPortions[1] + '</td>';
        html += '</tr>';
        
        // 数据行（按贵客率降序排列）
        var rates = Object.keys(guestPortionTable).map(Number).sort(function(a, b) { return b - a; });
        for (var i = 0; i < rates.length; i++) {
            var rate = rates[i];
            var data = guestPortionTable[rate];
            html += '<tr>';
            html += '<td class="rate-cell">' + rate + '%</td>';
            html += '<td class="portion-cell highlight">' + data[5] + '</td>';
            html += '<td class="portion-cell highlight">' + data[4] + '</td>';
            html += '<td class="portion-cell highlight">' + data[3] + '</td>';
            html += '<td class="portion-cell highlight">' + data[2] + '</td>';
            html += '<td class="portion-cell highlight">' + data[1] + '</td>';
            html += '</tr>';
        }
        
        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        html += '</div>';
        
        // 弹窗底部
        html += '<div class="modal-footer">';
        html += '<button type="button" class="btn btn-default" data-dismiss="modal">关闭</button>';
        html += '</div>';
        
        html += '</div></div></div>';
        
        // 添加到页面并显示
        $('body').append(html);
        $('#guest-portion-table-modal').modal('show');
    }

    // ========================================
    // 应用查询结果
    // ========================================
    
    /**
     * 将查询结果应用到选择框（增强版）
     * 使用与修炼查询模式相同的方式：通过 setCustomChef/setCustomRecipe 设置数据
     * @param {Object} result - 查询结果
     * @param {boolean} skipChefUpdate - 是否跳过厨师更新（场上已有厨师时为true）
     */
    function applyResultToSelectors(result, skipChefUpdate) {
        if (!result || !result.success) {
            return;
        }
        
        if (skipChefUpdate) {
        }
        
        // 检查必要的函数是否存在
        if (typeof setCustomChef !== 'function' || typeof setCustomRecipe !== 'function') {
            console.error('setCustomChef 或 setCustomRecipe 函数不存在');
            return;
        }
        
        // 获取游戏数据
        var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
                       ? calCustomRule.gameData : null;
        
        // 获取页面设置的厨具（优先级最高）
        var pageEquipsByPosition = result.pageEquipsByPosition || {};
        var hasPageEquips = Object.keys(pageEquipsByPosition).length > 0;
        
        // 如果不跳过厨师更新，先清空所有位置
        if (!skipChefUpdate) {
            for (var i = 0; i < 3; i++) {
                setCustomChef(0, i, null);
                // 清空厨具
                if (typeof setCustomEquip === 'function') {
                    setCustomEquip(0, i, null);
                }
                for (var j = 0; j < 3; j++) {
                    setCustomRecipe(0, i, j, null);
                }
            }
        } else {
            // 只清空菜谱位置，保留厨师和厨具
            for (var i = 0; i < 3; i++) {
                for (var j = 0; j < 3; j++) {
                    setCustomRecipe(0, i, j, null);
                }
            }
        }
        
        // 应用厨师、厨具和菜谱
        for (var i = 0; i < result.positions.length && i < 3; i++) {
            var pos = result.positions[i];
            
            if (pos.type === "empty") continue;
            
            // 设置厨师（如果不跳过厨师更新）
            // 注意：setCustomChef 会自动设置厨师已佩戴的厨具（当勾选"已配厨具"时）
            // 我们需要在设置厨师后，根据页面厨具设置来决定是否覆盖
            if (!skipChefUpdate && pos.chef && pos.chef.chefId) {
                setCustomChef(0, i, pos.chef.chefId);
            }
            
            // 设置厨具：
            // 1. 页面设置了厨具 → 使用页面厨具（优先级最高）
            // 2. 页面没设置厨具 → 保持 setCustomChef 自动设置的厨师已佩戴厨具（由"已配厨具"开关控制）
            if (!skipChefUpdate && typeof setCustomEquip === 'function') {
                if (hasPageEquips && pageEquipsByPosition[i]) {
                    var pageEquip = pageEquipsByPosition[i];
                    setCustomEquip(0, i, pageEquip.equipId);
                }
                // 页面没设置厨具时，不做任何操作，保持 setCustomChef 自动设置的结果
            }
            
            // 设置菜谱和份数
            if (pos.recipes && pos.recipes.length > 0) {
                for (var j = 0; j < pos.recipes.length && j < 3; j++) {
                    var recipe = pos.recipes[j];
                    if (recipe && recipe.recipeId) {
                        setCustomRecipe(0, i, j, recipe.recipeId);
                        
                        // 设置份数（如果有recipeDetails）
                        if (pos.recipeDetails && pos.recipeDetails[j] && typeof setCustomRecipeQuantity === 'function') {
                            var quantity = pos.recipeDetails[j].quantity || 7;
                            setCustomRecipeQuantity(0, i, j, quantity);
                        }
                    }
                }
            }
        }
        
        // 设置品级（如果有符文类厨师的品级要求）
        if (result.qualityLevel) {
            var $qualitySelect = $('#quality-level');
            if ($qualitySelect.length) {
                $qualitySelect.val(result.qualityLevel);
                // 如果使用了 selectpicker，需要刷新
                if ($qualitySelect.data('selectpicker')) {
                    $qualitySelect.selectpicker('refresh');
                }
            }
        }
        
        // 设置星级选择框（根据选中符文的最高菜谱星级）
        if (result.calculatedStarLevel) {
            var $starSelect = $('#star-level');
            if ($starSelect.length) {
                $starSelect.val(result.calculatedStarLevel);
                // 如果使用了 selectpicker，需要刷新
                if ($starSelect.data('selectpicker')) {
                    $starSelect.selectpicker('refresh');
                }
            }
        }
        
        // 设置主份数输入框（根据查询模式设置）
        if (result.calculatedQuantity) {
            var $quantityInput = $('#quantity-value');
            if ($quantityInput.length) {
                $quantityInput.val(result.calculatedQuantity);
            }
        }
        
        // 触发计算更新 UI
        // 无论是否跳过厨师更新，都需要调用 calCustomResults 来更新页面显示（包括份数）
        if (typeof calCustomResults === 'function') {
            calCustomResults(gameData);
        }
        
    }

    // ========================================
    // 初始化
    // ========================================
    
    /**
     * 初始化一键查询模块
     */
    function init() {
        loadSettings();
        loadJadeRecipeValueMap();
        preloadJadeRankingTableData(false);
        
        // 绑定一键查询按钮事件
        $(document).on('click', '#btn-oneclick-query', function() {
            var result = executeQuery();
            if (result && result.success) {
                // 如果使用了场上已有厨师，跳过厨师更新
                var skipChefUpdate = result.useExistingChefs || false;
                applyResultToSelectors(result, skipChefUpdate);
                
                // 如果有无法达到必来的菜谱，显示提示（包含菜谱名称）
                if (result.cannotAchieveRecipes && result.cannotAchieveRecipes.length > 0) {
                    var recipeNames = result.cannotAchieveRecipes.map(function(name) {
                        return '<span style="color:#337ab7;font-weight:bold;">' + name + '</span>';
                    }).join('、');
                    showAlert(recipeNames + ' 无法做到必来，已使用最高贵客率组合');
                }
                
                // 显示结果消息
                if (result.message) {
                }
            } else if (result) {
                showAlert(result.message || '查询失败');
            }
        });

        $(document).on('click', '#btn-oneclick-query-jade', function() {
            var result = executeQuery();
            if (result && result.success) {
                var skipChefUpdate = result.useExistingChefs || false;
                applyResultToSelectors(result, skipChefUpdate);

                if (result.cannotAchieveRecipes && result.cannotAchieveRecipes.length > 0) {
                    var recipeNames = result.cannotAchieveRecipes.map(function(name) {
                        return '<span style="color:#337ab7;font-weight:bold;">' + name + '</span>';
                    }).join('、');
                    showAlert(recipeNames + ' 无法做到必来，已按当前刷玉查询结果填充份数');
                }
            } else if (result) {
                showAlert(result.message || '查询失败');
            }
        });
        
        // 绑定查询设置按钮事件
        $(document).on('click', '#btn-query-settings', function() {
            showSettingsDialog();
        });

        $(document).on('click', '#btn-query-settings-jade', function() {
            showSettingsDialog();
        });

        $(window).off('resize.jadeRankingModal').on('resize.jadeRankingModal', function() {
            updateJadeRankingModalWidth();
        });
    }
    
    /**
     * 显示右上角提示消息
     * @param {string} message - 提示消息
     * @param {string} type - 类型：'info', 'warning', 'error', 'success'
     */
    // showToast 和 showAlert 已移至 food.min.js 作为公共函数
    
    // ========================================
    // 公共接口
    // ========================================
    
    return {
        init: init,
        loadSettings: loadSettings,
        saveSettings: saveSettings,
        getSetting: getSetting,
        setSetting: setSetting,
        executeQuery: executeQuery,
        showSettingsDialog: showSettingsDialog,
        applyResultToSelectors: applyResultToSelectors,
        getSelectedRunes: getSelectedRunes,
        // 暴露辅助函数供外部使用
        getRecipeRank: getRecipeRank,
        getSkillDiff: getSkillDiff,
        analyzeChefSkills: analyzeChefSkills,
        getAuraChefs: getAuraChefs,
        // 份数计算函数
        calculateRecipeQuantity: calculateRecipeQuantity,
        calculateCookingTime: calculateCookingTime,
        getRequiredPortionsForStarLevel: getRequiredPortionsForStarLevel,
        getUserMaxQuantity: getUserMaxQuantity, // 获取用户实际最大份数
        // 常量
        GOLD_RUNES: GOLD_RUNES,
        SILVER_RUNES: SILVER_RUNES,
        BRONZE_RUNES: BRONZE_RUNES,
        MIN_QUANTITY_MAP: MIN_QUANTITY_MAP,
        BASE_MAX_QUANTITY_MAP: BASE_MAX_QUANTITY_MAP // 基础最大份数（不含修炼加成）
    };
    
})(jQuery);

// 页面加载完成后初始化
$(document).ready(function() {
    if (typeof OneClickQuery !== 'undefined') {
        OneClickQuery.init();
    }
});
