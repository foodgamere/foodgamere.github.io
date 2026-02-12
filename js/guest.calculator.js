/**
 * 贵客率计算器模块
 * Guest Rate Calculator Module
 * 
 * @description 独立的贵客率计算模块，负责处理所有与贵客率计算相关的逻辑
 * 
 * @dependencies
 * - jQuery (必需)
 * - Bootstrap Selectpicker (必需)
 * - CalCustomRule 全局对象 (必需)
 * - food.min.js 中的辅助函数:
 *   - updateEquipmentEffect()
 *   - getAmberDisplayByLevel()
 *   - calCustomResults()
 * 
 * @author foodgame-local
 * @license MIT
 */

var GuestRateCalculator = (function($) {
    'use strict';
    
    // ========================================
    // 私有变量
    // ========================================
    
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
     * 品级对应的符文率
     */
    var RUNE_RATE_MAP = {
        "1": 50,  // 可级 50%
        "2": 51,  // 优级 51%
        "3": 52,  // 特级 52%
        "4": 53,  // 神级 53%
        "5": 53   // 传级 53%
    };
    
    /**
     * 品级数字到中文的映射
     */
    var QUALITY_LEVEL_NAMES = {
        "1": "可",
        "2": "优",
        "3": "特",
        "4": "神",
        "5": "传"
    };
    
    /**
     * 符文列表常量
     */
    var GOLD_RUNES = ['恐怖利刃', '鼓风机', '蒸馏杯', '千年煮鳖', '香烤鱼排', '五星炒果'];
    var SILVER_RUNES = ['刀嘴鹦鹉', '一昧真火', '蒸汽宝石', '耐煮的水草', '焦虫', '暖石'];
    var BRONZE_RUNES = ['剪刀蟹', '油火虫', '蒸汽耳环', '防水的柠檬', '烤焦的菊花', '五香果'];
    var ALL_RUNES = [].concat(GOLD_RUNES, SILVER_RUNES, BRONZE_RUNES);
    
    // ========================================
    // 私有函数 - 输入验证
    // ========================================
    
    /**
     * 验证份数输入
     * @private
     * @param {jQuery} input - jQuery 输入框对象
     */
    function validateQuantity(input) {
        var val = parseInt(input.val()) || 1;
        if (val < 1) {
            input.val(1);
        } else if (val > 999) {
            input.val(999);
        }
    }
    
    /**
     * 验证贵客率输入
     * @private
     * @param {jQuery} input - jQuery 输入框对象
     */
    function validateGuestRate(input) {
        var val = parseInt(input.val()) || 0;
        if (val < 0) {
            input.val(0);
        } else if (val > 999) {
            input.val(999);
        }
    }
    
    // ========================================
    // 私有函数 - 核心计算
    // ========================================
    
    /**
     * 根据星级和份数计算实际贵客率
     * @private
     * @param {number} starLevel - 星级 (1-5)
     * @param {number} quantity - 份数 (1-999)
     * @param {number} baseGuestRate - 基础贵客率 (%)
     * @returns {number} 实际贵客率 (%)
     */
    function calculateActualGuestRate(starLevel, quantity, baseGuestRate) {
        // 检查最低份数要求
        var minQuantity = MIN_QUANTITY_MAP[starLevel] || 7;
        
        if (quantity < minQuantity) {
            return 0.0;
        }
        
        // 根据星级计算实际贵客率
        var actualRate = 0;
        switch(starLevel) {
            case 1:
                actualRate = (0.05 + (quantity - 20) * 0.013) * (100 + baseGuestRate);
                break;
            case 2:
                actualRate = (0.08 + (quantity - 15) * 0.02) * (100 + baseGuestRate);
                break;
            case 3:
                actualRate = (0.083 + (quantity - 12) * 0.016) * (100 + baseGuestRate);
                break;
            case 4:
                actualRate = (0.1142 + (quantity - 10) * 0.0059) * (100 + baseGuestRate);
                break;
            case 5:
                actualRate = (0.1006 + (quantity - 7) * 0.0084) * (100 + baseGuestRate);
                break;
            default:
                actualRate = (0.1006 + (quantity - 7) * 0.0084) * (100 + baseGuestRate);
        }
        
        // 截断取整后除以100
        return Math.trunc(actualRate * 100.0) / 100.0;
    }
    
    /**
     * 根据品级计算符文率
     * @private
     * @param {string} rank - 品级 ("可", "优", "特", "神", "传")
     * @returns {number} 符文率 (%)
     */
    function getRuneRateByRank(rank) {
        var baseRuneRate = {
            "传": 53,
            "神": 53,
            "特": 52,
            "优": 51,
            "可": 50
        }[rank] || 50;
        
        return baseRuneRate;
    }
    
    /**
     * 计算百锅产出
     * @private
     * @param {number} actualGuestRate - 实际贵客率 (%)
     * @param {number} runeRate - 符文率 (%)
     * @param {number} critRate - 暴击率 (%)
     * @returns {number} 百锅产出
     */
    function calculateHundredPotOutput(actualGuestRate, runeRate, critRate) {
        if (actualGuestRate <= 0.0) {
            return 0.0;
        }
        
        var result = 0.01 * actualGuestRate * runeRate * critRate;
        return Math.trunc(result) / 100.0;
    }
    
    /**
     * 计算单位食材
     * @private
     * @param {number} actualGuestRate - 实际贵客率 (%)
     * @param {number} runeRate - 符文率 (%)
     * @param {number} critRate - 暴击率 (%)
     * @param {number} quantity - 份数
     * @returns {number} 单位食材
     */
    function calculateUnitFood(actualGuestRate, runeRate, critRate, quantity) {
        if (actualGuestRate <= 0.0 || quantity <= 0) {
            return 0.0;
        }
        
        var result = 0.1 / quantity * actualGuestRate * runeRate * critRate;
        return Math.trunc(result) / 100.0;
    }
    
    /**
     * 计算单位时间
     * @private
     * @param {number} unitFood - 单位食材
     * @param {number} timeRate - 时间效率 (%)
     * @returns {number} 单位时间
     */
    function calculateUnitTime(unitFood, timeRate) {
        if (unitFood <= 0.0 || timeRate <= 0.0) {
            return 0.0;
        }
        
        var result = unitFood * 100 / timeRate * 100;
        return Math.trunc(result) / 100.0;
    }
    
    /**
     * 格式化数字，去掉末尾的0
     * @private
     * @param {number} value - 要格式化的数字
     * @returns {string} 格式化后的字符串
     */
    function formatNumber(value) {
        return parseFloat(value.toFixed(2)).toString();
    }
    
    // ========================================
    // 公共函数
    // ========================================
    
    /**
     * 初始化贵客率计算器
     * 设置所有 UI 交互、事件监听器和验证逻辑
     * @public
     */
    function init() {
        // 初始化selectpicker
        $("#star-level").selectpicker();
        $("#quality-level").selectpicker();
        $("#star-level-2").selectpicker();
        $("#star-level-3").selectpicker();
        
        // 初始化厨师选择框的分类标签
        initChefCategoryTabs('chef');
        
        // 初始化厨具选择框的分类标签
        initChefCategoryTabs('equip');
        
        // 初始化菜谱选择框的分类标签
        initChefCategoryTabs('recipe');
        
        // 给主菜谱份数输入框添加验证（最小值1）
        $("#quantity-value").on("input change", function() {
            validateQuantity($(this));
            // 触发正常营业计算，这会调用 updateCalSummaryDisplay 并更新贵客率计算器
            if (typeof calCustomResults === 'function') {
                calCustomResults();
            }
        });
        
        // 给双菜谱份数输入框添加验证（最小值0），不触发 calCustomResults
        $("#quantity-value-2, #quantity-value-3").on("input change", function() {
            var val = parseInt($(this).val());
            if (isNaN(val) || val < 0) {
                $(this).val(0);
            } else if (val > 999) {
                $(this).val(999);
            }
            calculateDualRecipe();
        });
        
        // 给贵客率输入框添加验证
        $("#guest-rate-input").on("input change", function() {
            validateGuestRate($(this));
        });
        
        // 监听星级和品级变化
        $("#star-level, #quality-level").on("changed.bs.select", function() {
            // 触发正常营业计算，这会调用 updateCalSummaryDisplay 并更新贵客率计算器
            if (typeof calCustomResults === 'function') {
                calCustomResults();
            }
        });
        
        // 折叠/展开按钮
        $(".guest-rate-calculator .btn-collapse").off("click").on("click", function() {
            $(this).closest(".guest-rate-calculator").toggleClass("collapsed");
        });
        
        // 数量加减按钮 - 主菜谱
        $("#quantity-plus").off("click").on("click", function() {
            var input = $("#quantity-value");
            var val = parseInt(input.val()) || 0;
            input.val(val + 1);
            if (typeof calCustomResults === 'function') {
                calCustomResults();
            }
        });
        
        $("#quantity-minus").off("click").on("click", function() {
            var input = $("#quantity-value");
            var val = parseInt(input.val()) || 0;
            if (val > 1) {
                input.val(val - 1);
                if (typeof calCustomResults === 'function') {
                    calCustomResults();
                }
            }
        });
        
        // 数量加减按钮 - 双菜谱1
        $("#quantity-plus-2").off("click").on("click", function() {
            var input = $("#quantity-value-2");
            var val = parseInt(input.val()) || 0;
            input.val(val + 1);
            calculateDualRecipe();
        });
        
        $("#quantity-minus-2").off("click").on("click", function() {
            var input = $("#quantity-value-2");
            var val = parseInt(input.val()) || 0;
            if (val > 0) {
                input.val(val - 1);
                calculateDualRecipe();
            }
        });
        
        // 数量加减按钮 - 双菜谱2
        $("#quantity-plus-3").off("click").on("click", function() {
            var input = $("#quantity-value-3");
            var val = parseInt(input.val()) || 0;
            input.val(val + 1);
            calculateDualRecipe();
        });
        
        $("#quantity-minus-3").off("click").on("click", function() {
            var input = $("#quantity-value-3");
            var val = parseInt(input.val()) || 0;
            if (val > 0) {
                input.val(val - 1);
                calculateDualRecipe();
            }
        });
        
        // 同贵客双菜谱按钮
        $("#sync-guest-double").off("click").on("click", function() {
            var section = $(".double-recipe-section");
            if (section.is(":visible")) {
                section.slideUp(300);
            } else {
                // 展开时，同步贵客率到输入框
                var guestRateText = $("#guest-rate-value").text();
                var guestRateValue = parseFloat(guestRateText.replace("%", "")) || 0;
                $("#guest-rate-input").val(guestRateValue);
                
                section.slideDown(300);
                // 展开后立即计算一次
                calculateDualRecipe();
            }
        });
        
        // 监听同贵客双菜谱区域的输入变化（份数输入框已在上方单独绑定）
        $("#guest-rate-input, #star-level-2, #star-level-3").on("change input", function() {
            calculateDualRecipe();
        });
        
        // 覆盖 getCalRecipeDisp 函数，在贵客率计算模式下显示符文信息，在碰瓷查询模式下显示碰瓷贵客
        if (typeof window.getCalRecipeDisp === 'function') {
            var originalGetCalRecipeDisp = window.getCalRecipeDisp;
            window.getCalRecipeDisp = function(e) {
                var a = e.data;
                var recipeName = a.name;
                
                // 检查是否为碰瓷查询模式
                var isPengciMode = $("#chk-guest-query-mode").prop("checked");
                
                // 在碰瓷查询模式下，显示当前品级对应的碰瓷贵客
                if (isGuestRateMode() && isPengciMode && a.guests && a.guests.length > 0) {
                    // 获取菜谱当前个人品级对应的碰瓷贵客
                    // a.rank: 菜谱个人数据中的品级（可/优/特/神/传）
                    // guests[0]=优级贵客, guests[1]=特级贵客, guests[2]=神级贵客
                    var currentRank = 0;
                    var personalRank = a.rank || '可';
                    if (personalRank === '可') currentRank = 1;
                    else if (personalRank === '优') currentRank = 2;
                    else if (personalRank === '特') currentRank = 3;
                    else if (personalRank === '神') currentRank = 4;
                    else if (personalRank === '传') currentRank = 5;
                    
                    // 找到下一个可碰瓷的贵客（当前品级+1对应的贵客）
                    // 优级(2)对应guests[0], 特级(3)对应guests[1], 神级(4)对应guests[2]
                    var nextGuestIndex = currentRank - 1; // 当前品级对应的下一个碰瓷目标索引
                    if (nextGuestIndex >= 0 && nextGuestIndex < Math.min(a.guests.length, 3)) {
                        var pengciGuest = a.guests[nextGuestIndex];
                        if (pengciGuest && pengciGuest.guest) {
                            recipeName = a.name + '-' + pengciGuest.guest;
                        }
                    }
                }
                // 在贵客率计算模式（非碰瓷模式）下，尝试获取符文信息
                else if (isGuestRateMode() && typeof calCustomRule !== 'undefined' && calCustomRule.gameData && calCustomRule.gameData.guests) {
                    var runeName = getRecipeRuneName(a, calCustomRule.gameData);
                    if (runeName) {
                        recipeName = a.name + '-' + runeName;
                    }
                }
                
                var rankClass = '';
                if (e.rankDisp) {
                    if (e.rankDisp === '可') rankClass = ' rank-ke';
                    else if (e.rankDisp === '优') rankClass = ' rank-you';
                    else if (e.rankDisp === '特') rankClass = ' rank-te';
                    else if (e.rankDisp === '神') rankClass = ' rank-shen';
                    else if (e.rankDisp === '传') rankClass = ' rank-chuan';
                }
                
                return "<div class='name'>" + recipeName + "</div><div class='recipe-ric'><div class='rank" + rankClass + "'>" + (e.rankDisp ? e.rankDisp : "") + "</div><div class='icon-box'>" + a.icon + "</div><div class='condiment'>" + a.condimentDisp + "</div></div>";
            };
        }
        
        // 覆盖 getCustomAmbersOptions 函数，在贵客率计算模式和修炼查询模式下过滤心法盘
        if (typeof window.getCustomAmbersOptions === 'function') {
            var originalGetCustomAmbersOptions = window.getCustomAmbersOptions;
            window.getCustomAmbersOptions = function(e, a, t, i, l) {
                // 调用原始函数获取选项列表
                var options = originalGetCustomAmbersOptions(e, a, t, i, l);
                
                // 检查是否为修炼查询模式
                var isCultivateMode = calCustomRule && calCustomRule.isCultivate === true;
                
                // 如果不是贵客率计算模式也不是修炼查询模式，直接返回
                if (!isGuestRateMode() && !isCultivateMode) {
                    return options;
                }
                
                // 过滤选项
                var filteredOptions = [];
                for (var idx = 0; idx < options.length; idx++) {
                    var opt = options[idx];
                    
                    // 保留"无遗玉"选项
                    if (!opt.value || opt.value === "") {
                        filteredOptions.push(opt);
                        continue;
                    }
                    
                    // 查找对应的心法盘数据
                    var amber = null;
                    for (var m in i) {
                        if (i[m].amberId == opt.value) {
                            amber = i[m];
                            break;
                        }
                    }
                    
                    // 根据模式选择不同的过滤函数
                    if (isGuestRateMode()) {
                        // 贵客率模式：包含贵客率加成
                        if (amber && hasUsefulAmberSkill(amber)) {
                            filteredOptions.push(opt);
                        }
                    } else if (isCultivateMode) {
                        // 修炼查询模式：只保留技法加成类和份数加成类
                        if (amber && hasCultivateUsefulAmberSkill(amber)) {
                            filteredOptions.push(opt);
                        }
                    }
                }
                
                // 按星级降序排序（跳过第一个"无遗玉"选项）
                if (filteredOptions.length > 1) {
                    var noAmberOpt = filteredOptions[0];
                    var amberOpts = filteredOptions.slice(1);
                    
                    amberOpts.sort(function(a, b) {
                        // 查找对应的心法盘数据获取星级
                        var amberA = null, amberB = null;
                        for (var m in i) {
                            if (i[m].amberId == a.value) amberA = i[m];
                            if (i[m].amberId == b.value) amberB = i[m];
                        }
                        var rarityA = amberA ? (amberA.rarity || 0) : 0;
                        var rarityB = amberB ? (amberB.rarity || 0) : 0;
                        return rarityB - rarityA;
                    });
                    
                    filteredOptions = [noAmberOpt].concat(amberOpts);
                }
                
                return filteredOptions;
            };
        }
    }
    
    /**
     * 检查心法盘是否有技法加成或份数上限加成（修炼查询模式专用）
     * 只保留技法加成类和份数加成类，不包括贵客率
     * @private
     * @param {Object} amber - 心法盘数据
     * @returns {boolean} 是否有有用的技能
     */
    function hasCultivateUsefulAmberSkill(amber) {
        if (!amber) {
            return false;
        }
        
        // 修炼查询模式有用的技能类型：技法加成、份数上限加成
        var usefulTypes = [
            'Stirfry',   // 炒技法加成
            'Boil',      // 煮技法加成
            'Knife',     // 切技法加成
            'Fry',       // 炸技法加成
            'Bake',      // 烤技法加成
            'Steam',     // 蒸技法加成
            'MaxEquipLimit'    // 份数上限加成
        ];
        
        // 优先检查 allEffect（包含所有等级的效果）
        if (amber.allEffect && amber.allEffect.length > 0) {
            for (var level = 0; level < amber.allEffect.length; level++) {
                var effects = amber.allEffect[level];
                if (effects) {
                    for (var i = 0; i < effects.length; i++) {
                        var effect = effects[i];
                        if (effect && effect.type && usefulTypes.indexOf(effect.type) >= 0) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }
        
        // 如果没有 allEffect，检查 effect（基础效果）
        if (amber.effect && amber.effect.length > 0) {
            for (var i = 0; i < amber.effect.length; i++) {
                var effect = amber.effect[i];
                if (effect && effect.type && usefulTypes.indexOf(effect.type) >= 0) {
                    return true;
                }
            }
            return false;
        }
        
        return false;
    }

    /**
     * 检查心法盘是否有技法加成、贵客率加成或份数上限加成
     * 过滤掉售价类心法盘（Use*类型是售价加成，不是技法加成）
     * @private
     * @param {Object} amber - 心法盘数据
     * @returns {boolean} 是否有有用的技能
     */
    function hasUsefulAmberSkill(amber) {
        if (!amber) {
            return false;
        }
        
        // 有用的技能类型：技法加成、贵客率加成、份数上限加成
        // 注意：Use* 类型（如 UseStirfry）是售价加成，不是技法加成，需要排除
        var usefulTypes = [
            'Stirfry',   // 炒技法加成
            'Boil',      // 煮技法加成
            'Knife',     // 切技法加成
            'Fry',       // 炸技法加成
            'Bake',      // 烤技法加成
            'Steam',     // 蒸技法加成
            'GuestApearRate',  // 贵客率加成
            'MaxEquipLimit'    // 份数上限加成
        ];
        
        // 优先检查 allEffect（包含所有等级的效果）
        if (amber.allEffect && amber.allEffect.length > 0) {
            for (var level = 0; level < amber.allEffect.length; level++) {
                var effects = amber.allEffect[level];
                if (effects) {
                    for (var i = 0; i < effects.length; i++) {
                        var effect = effects[i];
                        if (effect && effect.type && usefulTypes.indexOf(effect.type) >= 0) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }
        
        // 如果没有 allEffect，检查 effect（基础效果）
        if (amber.effect && amber.effect.length > 0) {
            for (var i = 0; i < amber.effect.length; i++) {
                var effect = amber.effect[i];
                if (effect && effect.type && usefulTypes.indexOf(effect.type) >= 0) {
                    return true;
                }
            }
            return false;
        }
        
        return false;
    }
    
    /**
     * 获取菜谱对应的符文名称
     * @private
     * @param {Object} recipeData - 菜谱数据
     * @param {Object} gameData - 游戏数据
     * @returns {string|null} 符文名称，如果没有则返回null
     */
    function getRecipeRuneName(recipeData, gameData) {
        if (!recipeData || !gameData || !gameData.guests) {
            return null;
        }
        
        for (var guestIdx = 0; guestIdx < gameData.guests.length; guestIdx++) {
            var guest = gameData.guests[guestIdx];
            if (guest.gifts) {
                for (var giftIdx = 0; giftIdx < guest.gifts.length; giftIdx++) {
                    var gift = guest.gifts[giftIdx];
                    if (gift.recipe === recipeData.name && gift.antique) {
                        return gift.antique;
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * 计算贵客率结果（基础版本，用于简单场景）
     * 根据输入参数计算实际贵客率、符文率、百锅产出等
     * @public
     */
    function calculateResults() {
        // 获取输入值
        var baseGuestRate = parseFloat($("#guest-rate-input").val()) || 0;
        var starLevel = parseInt($("#star-level").val()) || 5;
        var qualityLevelValue = $("#quality-level").val() || "1";
        var quantity = parseInt($("#quantity-value").val()) || 7;
        
        // 将品级值转换为中文
        var qualityLevel = QUALITY_LEVEL_NAMES[qualityLevelValue] || "可";
        
        // 计算实际贵客率
        var actualGuestRate = calculateActualGuestRate(starLevel, quantity, baseGuestRate);
        
        // 计算符文率
        var runeRate = getRuneRateByRank(qualityLevel);
        
        // 暴击率固定为100（后续会根据厨师技能计算）
        var critRate = 100;
        
        // 计算百锅产出
        var hundredPotOutput = calculateHundredPotOutput(actualGuestRate, runeRate, critRate);
        
        // 计算单位食材
        var unitFood = calculateUnitFood(actualGuestRate, runeRate, critRate, quantity);
        
        // 计算单位时间（暂时使用100作为时间效率）
        var timeRate = 100;
        var unitTime = calculateUnitTime(unitFood, timeRate);
        
        // 更新显示
        $("#guest-rate-value").text(baseGuestRate.toFixed(2) + "%");
        $("#total-crit-rate").text(critRate.toFixed(2) + "%");
        $("#time-percentage").text("100%");
        $("#actual-guest-rate").text((Math.floor(actualGuestRate * 100) / 100).toFixed(2) + "%");
        $("#rune-rate").text(runeRate + "%");
        $("#hundred-pot-output").text(hundredPotOutput.toFixed(2));
        $("#unit-material").text(unitFood.toFixed(2));
        $("#unit-time").text(unitTime.toFixed(2));
    }
    
    /**
     * 计算同贵客双菜谱数据
     * 计算两个菜谱的组合贵客率和符文概率
     * @public
     */
    function calculateDualRecipe() {
        // 获取输入值
        var baseGuestRate = parseFloat($("#guest-rate-input").val()) || 0;
        var starLevel1 = parseInt($("#star-level-2").val()) || 5;
        var quantity1 = parseInt($("#quantity-value-2").val()) || 7;
        var starLevel2 = parseInt($("#star-level-3").val()) || 5;
        var quantity2 = parseInt($("#quantity-value-3").val()) || 7;
        
        // 计算实际贵客率1
        var actualGuestRate1 = calculateActualGuestRate(starLevel1, quantity1, baseGuestRate);
        
        // 计算实际贵客率2
        var actualGuestRate2 = calculateActualGuestRate(starLevel2, quantity2, baseGuestRate);
        
        // 计算总贵客率
        var totalGuestRate = actualGuestRate1 + actualGuestRate2;
        
        // 计算限制后的总贵客率（最大100）
        var limitedTotalGuestRate = totalGuestRate > 100.0 ? 100.0 : totalGuestRate;
        
        // 计算撒币概率：限制后的总贵客率 / 2，截断取整后除以100
        var scatterProbability = Math.floor(limitedTotalGuestRate / 2.0 * 100) / 100;
        
        // 计算符文A概率和符文B概率
        var runeAProbability = 0.0;
        var runeBProbability = 0.0;
        
        if ((actualGuestRate1 + actualGuestRate2) > 0) {
            // 符文A概率：实际贵客率1 / (实际贵客率1 + 实际贵客率2) * 限制后总贵客率 / 2
            var runeARaw = actualGuestRate1 / (actualGuestRate1 + actualGuestRate2) * limitedTotalGuestRate / 2.0;
            runeAProbability = Math.floor(runeARaw * 100) / 100;
            
            // 符文B概率：实际贵客率2 / (实际贵客率1 + 实际贵客率2) * 限制后总贵客率 / 2
            var runeBRaw = actualGuestRate2 / (actualGuestRate1 + actualGuestRate2) * limitedTotalGuestRate / 2.0;
            runeBProbability = Math.floor(runeBRaw * 100) / 100;
        }
        
        // 确保概率不为负数
        runeAProbability = runeAProbability < 0 ? 0.0 : runeAProbability;
        runeBProbability = runeBProbability < 0 ? 0.0 : runeBProbability;
        
        // 更新显示
        $("#actual-guest-rate-2").text((Math.floor(actualGuestRate1 * 100) / 100).toFixed(2) + "%");
        $("#actual-guest-rate-3").text((Math.floor(actualGuestRate2 * 100) / 100).toFixed(2) + "%");
        $("#rune-a-probability").text((Math.floor(runeAProbability * 100) / 100).toFixed(2) + "%");
        $("#rune-b-probability").text((Math.floor(runeBProbability * 100) / 100).toFixed(2) + "%");
        $("#scatter-probability").text((Math.floor(scatterProbability * 100) / 100).toFixed(2) + "%");
        
        // 总实际贵客率显示时，如果超过100则显示100，但保留原始值用于计算
        var displayTotalGuestRate = totalGuestRate > 100.0 ? 100.0 : totalGuestRate;
        $("#total-guest-rate").text((Math.floor(displayTotalGuestRate * 100) / 100).toFixed(2) + "%");
    }
    
    /**
     * 计算贵客率相关的所有字段
     * 包括厨师技能、修炼技能、厨具技能、心法盘技能的加成
     * @public
     * @param {Object} custom - 自定义配置对象（包含厨师、厨具、菜谱等信息）
     * @param {Object} rule - 规则对象（包含技能、七侠加成等信息）
     * @param {number} starLevel - 星级 (1-5)
     * @param {number} quantity - 份数 (1-999)
     * @param {string} qualityLevel - 品级 ("1"-"5")
     * @returns {Object} 包含所有计算字段的对象
     */
    function calculateFields(custom, rule, starLevel, quantity, qualityLevel) {
        var result = {
            guestRate: 0,           // 贵客率
            critRate: 100,          // 暴击率，初始100%
            timePercentage: 100,    // 时间百分比，初始100%
            actualGuestRate: 0,     // 实际贵客率
            runeRate: 0,            // 符文率
            hundredPotOutput: 0,    // 百锅产出
            unitMaterialOutput: 0,  // 单位食材
            unitTimeOutput: 0       // 单位时间
        };
        
        // 获取七侠加成数据
        var qixiaData = rule && rule.calQixiaData ? rule.calQixiaData : null;
        
        // 获取本地数据
        var localData = typeof getLocalData === 'function' ? getLocalData() : null;
        
        // 性能优化：缓存配置页面的已修炼厨师ID列表，避免重复DOM查询
        var configUltimatedIds = typeof getConfigUltimatedChefIds === 'function' ? getConfigUltimatedChefIds() : null;
        
        // 统计 特技符文率(GuestAntiqueDropRate) 技能
        var guestAntiqueDropRateSkills = [];
        
        // 遍历所有场上厨师
        for (var c in custom) {
            if (!custom[c].chef || !custom[c].chef.chefId) {
                continue;
            }
            
            var chef = custom[c].chef;
            var equip = custom[c].equip;
            var recipes = custom[c].recipes || [];
            
            // 判断该厨师是否已修炼（使用公共函数，传入缓存的 configUltimatedIds）
            var isUltimated = false;
            if (typeof isChefUltimated === 'function') {
                isUltimated = isChefUltimated(chef.chefId, localData, configUltimatedIds);
            } else {
                // 降级方案：如果函数不存在，使用简单判断
                isUltimated = (chef.ultimate === "是");
            }
            
            // 收集所有技能
            var allSkills = [];
            var skillSources = []; // 记录技能来源，用于获取描述
            
            // 1. 厨师技能
            if (chef.specialSkillEffect) {
                var chefSkillDesc = chef.specialSkillDisp || '';
                
                for (var i = 0; i < chef.specialSkillEffect.length; i++) {
                    allSkills.push(chef.specialSkillEffect[i]);
                    skillSources.push({
                        type: 'chef',
                        desc: chefSkillDesc
                    });
                }
            }
            
            // 2. 修炼技能（只有已修炼的厨师才收集）
            if (isUltimated && chef.ultimateSkillEffect) {
                for (var i = 0; i < chef.ultimateSkillEffect.length; i++) {
                    allSkills.push(chef.ultimateSkillEffect[i]);
                    skillSources.push({
                        type: 'ultimate',
                        desc: chef.ultimateSkillDisp || ''
                    });
                }
            }
            
            // 3. 厨具技能（需要考虑 MutiEquipmentSkill 的增强效果）
            if (equip && equip.effect) {
                // 使用 updateEquipmentEffect 来处理 MutiEquipmentSkill
                var equipEffect = equip.effect;
                // 只有已修炼的厨师才应用修炼技能对厨具的增强效果
                if (isUltimated && chef.ultimateSkillEffect && typeof updateEquipmentEffect === 'function') {
                    equipEffect = updateEquipmentEffect(equip.effect, chef.ultimateSkillEffect);
                }
                
                // 为每个厨具技能找到对应的技能描述
                for (var i = 0; i < equipEffect.length; i++) {
                    var skillDesc = '';
                    // 从技能数据库中查找对应的技能描述
                    if (equip.skill && rule.skills) {
                        for (var skillIdx = 0; skillIdx < equip.skill.length; skillIdx++) {
                            var skillId = equip.skill[skillIdx];
                            for (var s = 0; s < rule.skills.length; s++) {
                                if (rule.skills[s].skillId === skillId) {
                                    // 检查这个技能的effect中是否包含当前的equipEffect[i]
                                    for (var e = 0; e < rule.skills[s].effect.length; e++) {
                                        if (rule.skills[s].effect[e].type === equipEffect[i].type) {
                                            skillDesc = rule.skills[s].desc;
                                            break;
                                        }
                                    }
                                    if (skillDesc) break;
                                }
                            }
                            if (skillDesc) break;
                        }
                    }
                    
                    allSkills.push(equipEffect[i]);
                    skillSources.push({
                        type: 'equip',
                        desc: skillDesc || equip.skillDisp || ''
                    });
                }
            }
            
            // 4. 心法盘技能
            if (chef.disk && chef.disk.ambers) {
                for (var a = 0; a < chef.disk.ambers.length; a++) {
                    var amber = chef.disk.ambers[a];
                    if (amber.data && amber.data.allEffect && chef.disk.level) {
                        var levelEffect = amber.data.allEffect[chef.disk.level - 1];
                        var amberDesc = '';
                        if (typeof getAmberDisplayByLevel === 'function') {
                            amberDesc = getAmberDisplayByLevel(amber.data, chef.disk.level);
                        }
                        if (levelEffect) {
                            for (var i = 0; i < levelEffect.length; i++) {
                                allSkills.push(levelEffect[i]);
                                skillSources.push({
                                    type: 'amber',
                                    desc: amberDesc
                                });
                            }
                        }
                    }
                }
            }
            
            // 遍历所有技能，根据类型分别计算
            for (var s = 0; s < allSkills.length; s++) {
                var skill = allSkills[s];
                var source = skillSources[s];
                
                // ========== 计算贵客率 (GuestApearRate) ==========
                if (skill.type === "GuestApearRate") {
                    var value = skill.value || 0;
                    var condition = skill.condition;
                    
                    if (condition === "Self") {
                        result.guestRate += value;
                    } else if (condition === "Partial") {
                        var effectCount = 0;
                        var conditionType = skill.conditionType;
                        var conditionValueList = skill.conditionValueList || [];
                        
                        if (conditionType === "ChefTag" && conditionValueList.length > 0) {
                            for (var cc in custom) {
                                if (!custom[cc].chef || !custom[cc].chef.chefId) {
                                    continue;
                                }
                                var chefTags = custom[cc].chef.tags || [];
                                for (var t = 0; t < conditionValueList.length; t++) {
                                    if (chefTags.indexOf(conditionValueList[t]) >= 0) {
                                        effectCount++;
                                        break;
                                    }
                                }
                            }
                        } else {
                            for (var cc in custom) {
                                if (custom[cc].chef && custom[cc].chef.chefId) {
                                    effectCount++;
                                }
                            }
                        }
                        result.guestRate += value * effectCount;
                    }
                }
                
                // ========== 计算暴击率 (GuestDropCount) ==========
                // 计算厨师技能、修炼技能和厨具技能，不计算心法盘
                if (skill.type === "GuestDropCount" && (source.type === 'chef' || source.type === 'ultimate' || source.type === 'equip')) {
                    var conditionType = skill.conditionType;
                    
                    if (conditionType === "PerRank") {
                        // PerRank 类型：根据菜谱品级计算
                        var conditionValue = skill.conditionValue || 4;
                        var desc = source.desc || "";
                        var percentMatch = desc.match(/(\d+)%/);
                        var basePercent = percentMatch ? parseInt(percentMatch[1]) : 0;
                        
                        var qualifiedRecipeCount = 0;
                        
                        // 如果没有菜谱信息（一键查询场景），默认使用最高暴击率（3个神级菜谱）
                        if (recipes.length === 0) {
                            qualifiedRecipeCount = 3;
                        } else {
                            for (var r = 0; r < recipes.length; r++) {
                                var recipe = recipes[r];
                                if (recipe.data && recipe.rankVal >= conditionValue) {
                                    qualifiedRecipeCount++;
                                }
                            }
                            qualifiedRecipeCount = Math.min(qualifiedRecipeCount, 3);
                        }
                        
                        var critIncrease = basePercent * qualifiedRecipeCount;
                        result.critRate += critIncrease;
                    } else {
                        // 非 PerRank 类型
                        var desc = source.desc || "";
                        // 从描述中提取"稀有客人赠礼数量XX%"中的百分比
                        var percentMatch = desc.match(/稀有客人赠礼数量(\d+)%/);
                        var basePercent = percentMatch ? parseInt(percentMatch[1]) : 0;
                        var multiplier = (skill.value || 100) / 100;
                        var critIncrease = basePercent * multiplier;
                        result.critRate += critIncrease;
                    }
                }
                
                // ========== 计算时间 (OpenTime) ==========
                // 只计算厨师技能、修炼技能和厨具技能，不计算心法盘
                if (skill.type === "OpenTime" && (source.type === 'chef' || source.type === 'ultimate' || source.type === 'equip')) {
                    var timeValue = skill.value || 0;
                    // 截断到一位小数（向0方向截断）：先乘10，向0取整，再除以10
                    timeValue = Math.trunc(timeValue * 10) / 10;
                    // value 为正数就加，负数就减
                    result.timePercentage += timeValue;
                }
                
                // ========== 统计符文率技能 (GuestAntiqueDropRate) ==========
                // 只计算厨师技能和修炼技能，不计算厨具和心法盘
                if (skill.type === "GuestAntiqueDropRate" && (source.type === 'chef' || source.type === 'ultimate')) {
                    guestAntiqueDropRateSkills.push({
                        value: skill.value,
                        conditionType: skill.conditionType,
                        conditionValue: skill.conditionValue
                    });
                }
            }
        }
        
        // ========== 应用七侠加成 ==========
        if (qixiaData) {
            // 遍历所有场上厨师，检查是否有七侠加成的 tag
            for (var c in custom) {
                if (!custom[c].chef || !custom[c].chef.chefId) {
                    continue;
                }
                var chef = custom[c].chef;
                var chefTags = chef.tags || [];
                
                // 检查厨师的每个 tag 是否有对应的七侠技法加成
                for (var t = 0; t < chefTags.length; t++) {
                    var tag = chefTags[t];
                    if (qixiaData[tag]) {
                        // 添加贵客率加成
                        if (qixiaData[tag].GuestApearRate) {
                            result.guestRate += qixiaData[tag].GuestApearRate;
                        }
                    }
                }
            }
        }
        
        // ========== 计算符文率 ==========
        // 获取品级对应的默认符文率
        var baseRuneRate = RUNE_RATE_MAP[qualityLevel] || 50;
        result.runeRate = baseRuneRate;
        
        // 计算符文率加成
        if (guestAntiqueDropRateSkills.length > 0) {
            var runeRateIncrease = 0;
            
            for (var i = 0; i < guestAntiqueDropRateSkills.length; i++) {
                var skill = guestAntiqueDropRateSkills[i];
                var isValid = false;
                
                // 如果技能有 conditionType 字段，并且为 Rank
                if (skill.conditionType === 'Rank') {
                    // 根据 conditionValue 判断品级是否满足
                    var requiredRank = skill.conditionValue || 3;
                    if (parseInt(qualityLevel) >= requiredRank) {
                        isValid = true;
                    }
                } else {
                    // 如果没有 conditionType 或不是 Rank，则不需要品级判断，直接生效
                    isValid = true;
                }
                
                if (isValid) {
                    // 累加每个技能的 value / 10
                    runeRateIncrease += (skill.value / 10);
                }
            }
            
            // 在默认符文率基础上，加上所有有效技能的贡献值
            if (runeRateIncrease > 0) {
                result.runeRate += runeRateIncrease;
            }
        }
        
        // ========== 计算实际贵客率 ==========
        if (starLevel && quantity) {
            var minQuantity = MIN_QUANTITY_MAP[starLevel] || 7;
            
            // 如果份数小于对应星级的最低要求，实际贵客率直接为0
            if (quantity < minQuantity) {
                result.actualGuestRate = 0;
            } else {
                var baseRate = 0;
                
                // 根据星级选择不同的公式
                switch(starLevel) {
                    case 1:
                        baseRate = (0.05 + (quantity - 20) * 0.013) * (100 + result.guestRate);
                        break;
                    case 2:
                        baseRate = (0.08 + (quantity - 15) * 0.02) * (100 + result.guestRate);
                        break;
                    case 3:
                        baseRate = (0.083 + (quantity - 12) * 0.016) * (100 + result.guestRate);
                        break;
                    case 4:
                        baseRate = (0.1142 + (quantity - 10) * 0.0059) * (100 + result.guestRate);
                        break;
                    case 5:
                        baseRate = (0.1006 + (quantity - 7) * 0.0084) * (100 + result.guestRate);
                        break;
                    default:
                        baseRate = (0.1006 + (quantity - 7) * 0.0084) * (100 + result.guestRate);
                }
                
                // 如果实际贵客率为负数，设置为0
                result.actualGuestRate = baseRate < 0 ? 0 : baseRate;
            }
        }
        
        // ========== 计算百锅产出 ==========
        if (result.actualGuestRate !== undefined && result.runeRate !== undefined && result.critRate !== undefined) {
            // 对实际贵客率截断取整保留两位小数
            var actualGuestRateRounded = Math.floor(result.actualGuestRate * 100) / 100;
            // 符文率是整数，不需要处理
            var runeRateValue = result.runeRate;
            // 对暴击率截断取整保留两位小数
            var critRateRounded = Math.floor(result.critRate * 100) / 100;
            
            // 使用处理后的值计算百锅产出
            var hundredPotOutput = 0.01 * actualGuestRateRounded * runeRateValue * critRateRounded;
            // 对最终结果截断取整保留两位小数，然后除以100
            result.hundredPotOutput = Math.floor(hundredPotOutput * 100) / 100 / 100;
            
            // ========== 计算单位食材 ==========
            if (quantity !== undefined && quantity > 0) {
                var unitMaterialOutput = (0.1 / quantity) * actualGuestRateRounded * runeRateValue * critRateRounded;
                // 对最终结果截断取整保留两位小数，然后除以100
                result.unitMaterialOutput = Math.floor(unitMaterialOutput * 100) / 100 / 100;
            }
            
            // ========== 计算单位时间 ==========
            // 只有当单位食材存在时才计算单位时间
            if (result.unitMaterialOutput > 0) {
                // 对单位食材截断取整保留两位小数
                var unitMaterialRounded = Math.floor(result.unitMaterialOutput * 100) / 100;
                // 对时间百分比截断取整保留两位小数
                var timePercentageRounded = Math.floor(result.timePercentage * 100) / 100;
                
                if (timePercentageRounded !== 0) {
                    var unitTimeOutput = unitMaterialRounded * 100 / timePercentageRounded * 100;
                    // 对最终结果截断取整保留两位小数，然后除以100
                    result.unitTimeOutput = Math.floor(unitTimeOutput * 100) / 100 / 100;
                }
            }
        }
        
        return result;
    }
    
    /**
     * 更新计算摘要显示
     * 更新所有显示字段，包括贵客率、暴击率、时间等
     * @public
     * @param {Object} calCustomRule - 全局计算规则对象
     */
    function updateSummaryDisplay(calCustomRule) {
        // 计算并更新贵客率计算器的所有字段
        if (calCustomRule.isGuestRate && calCustomRule.rules.length > 0) {
            // 获取星级、份数和品级
            var starLevel = parseInt($("#star-level").val()) || 5;
            var quantity = parseInt($("#quantity-value").val()) || 7;
            var qualityLevel = $("#quality-level").val() || "1";
            
            var fields = calculateFields(calCustomRule.rules[0].custom, calCustomRule.rules[0], starLevel, quantity, qualityLevel);
            
            // 更新显示（所有数值都使用截断取整，不使用四舍五入）
            $("#guest-rate-value").text(fields.guestRate + "%");
            $("#total-crit-rate").text((Math.floor(fields.critRate * 100) / 100).toFixed(2) + "%");
            $("#time-percentage").text(formatNumber(Math.floor(fields.timePercentage * 100) / 100) + "%");
            $("#actual-guest-rate").text((Math.floor(fields.actualGuestRate * 100) / 100).toFixed(2) + "%");
            $("#rune-rate").text(fields.runeRate + "%");
            
            // 同步贵客率到同贵客双菜谱区域（如果该区域已展开）
            if ($(".double-recipe-section").is(":visible")) {
                $("#guest-rate-input").val(fields.guestRate);
                // 重新计算同贵客双菜谱数据
                calculateDualRecipe();
            }
            
            // 显示百锅产出（使用截断取整）
            if (fields.hundredPotOutput !== undefined) {
                $("#hundred-pot-output").text((Math.floor(fields.hundredPotOutput * 100) / 100).toFixed(2));
            }
            
            // 显示单位食材（使用截断取整）
            if (fields.unitMaterialOutput !== undefined) {
                $("#unit-material").text((Math.floor(fields.unitMaterialOutput * 100) / 100).toFixed(2));
            }
            
            // 显示单位时间（使用截断取整）
            if (fields.unitTimeOutput !== undefined) {
                $("#unit-time").text((Math.floor(fields.unitTimeOutput * 100) / 100).toFixed(2));
            }
        }
    }
    
    // ========================================
    // 厨师分类查询功能
    // ========================================
    
    /**
     * 判断是否为贵客率计算模式
     * @public
     * @returns {boolean} true 表示贵客率计算模式，false 表示其他模式
     */
    function isGuestRateMode() {
        return typeof calCustomRule !== 'undefined' && calCustomRule && calCustomRule.isGuestRate === true;
    }
    
    /**
     * 分析厨师（包含技能、修炼技能、心法盘、厨具）、厨具关技能
     * @public
     * @param {Object} chefOrEquip - 厨师或厨具对象
     * @param {Object} qixiaData - 七侠加成数据
     * @param {boolean} useEquip - 是否使用厨具
     * @param {boolean} useAmber - 是否使用遗玉
     * @param {Object} localData - 本地数据
     * @param {Object} configUltimatedIds - 配置的已修炼厨师ID
     * @param {string} type - 类型：'chef' 或 'equip'
     * @returns {Object} 包含技能分析结果的对象
     */
    function analyzeChefGuestRateSkills(chefOrEquip, qixiaData, useEquip, useAmber, localData, configUltimatedIds, type) {
        type = type || 'chef'; // 默认为厨师
        
        var result = {
            hasSkills: false,
            categories: '',
            skillValues: {
                guestRate: 0,
                crit: 0,
                time: 0,
                rune: 0,
                rarity: chefOrEquip.rarity || 0
            }
        };
        
        var targetSkillTypes = ['GuestApearRate', 'GuestDropCount', 'OpenTime', 'GuestAntiqueDropRate'];
        var categoryFlags = {
            guestRate: false,
            crit: false,
            time: false,
            rune: false
        };
        
        // 如果是厨具，只分析厨具技能
        if (type === 'equip') {
            var equip = chefOrEquip;
            
            // 检查厨具技能
            if (equip.effect) {
                for (var i = 0; i < equip.effect.length; i++) {
                    var skill = equip.effect[i];
                    if (targetSkillTypes.indexOf(skill.type) >= 0) {
                        result.hasSkills = true;
                        
                        // 设置分类标记
                        if (skill.type === 'GuestApearRate') {
                            categoryFlags.guestRate = true;
                            if (skill.value) {
                                result.skillValues.guestRate += skill.value;
                            }
                        } else if (skill.type === 'OpenTime') {
                            categoryFlags.time = true;
                            if (skill.value) {
                                result.skillValues.time += skill.value;
                            }
                        }
                    }
                }
            }
            
            // 生成分类字符串（厨具只有贵客和时间两类）
            var categories = [];
            if (categoryFlags.guestRate) categories.push('guest-rate-category');
            if (categoryFlags.time) categories.push('time-category');
            result.categories = categories.join(' ');
            
            return result;
        }
        
        // 以下是厨师的分析逻辑
        var chef = chefOrEquip;
        
        // 检查该厨师是否已修炼
        var isUltimated = false;
        if (typeof isChefUltimated === 'function') {
            isUltimated = isChefUltimated(chef.chefId, localData, configUltimatedIds);
        }
        
        // 收集所有技能来源
        var allSkillSources = [];
        
        // 1. 厨师技能
        if (chef.specialSkillEffect) {
            for (var i = 0; i < chef.specialSkillEffect.length; i++) {
                var skill = chef.specialSkillEffect[i];
                if (targetSkillTypes.indexOf(skill.type) >= 0) {
                    result.hasSkills = true;
                }
                allSkillSources.push({
                    skill: skill,
                    type: 'chef',
                    desc: chef.specialSkillDisp || ''
                });
            }
        }
        
        // 2. 修炼技能
        if (chef.ultimateSkillEffect) {
            for (var i = 0; i < chef.ultimateSkillEffect.length; i++) {
                var skill = chef.ultimateSkillEffect[i];
                if (targetSkillTypes.indexOf(skill.type) >= 0) {
                    result.hasSkills = true;
                }
                if (isUltimated) {
                    allSkillSources.push({
                        skill: skill,
                        type: 'ultimate',
                        desc: chef.ultimateSkillDisp || ''
                    });
                }
            }
        }
        
        // 3. 厨具技能
        if (useEquip && chef.equip && chef.equip.effect) {
            for (var i = 0; i < chef.equip.effect.length; i++) {
                var skill = chef.equip.effect[i];
                if (targetSkillTypes.indexOf(skill.type) >= 0) {
                    result.hasSkills = true;
                }
                allSkillSources.push({
                    skill: skill,
                    type: 'equip',
                    desc: chef.equip.desc || ''
                });
            }
        }
        
        // 4. 心法盘技能
        var diskSkills = [];
        if (useAmber && chef.disk && chef.disk.ambers) {
            for (var a = 0; a < chef.disk.ambers.length; a++) {
                var amber = chef.disk.ambers[a];
                if (amber.data && amber.data.allEffect && chef.disk.level) {
                    var levelEffect = amber.data.allEffect[chef.disk.level - 1];
                    if (levelEffect) {
                        for (var i = 0; i < levelEffect.length; i++) {
                            var skill = levelEffect[i];
                            if (targetSkillTypes.indexOf(skill.type) >= 0) {
                                result.hasSkills = true;
                            }
                            diskSkills.push(skill);
                        }
                    }
                }
            }
        }
        
        // 5. 检查七侠加成
        if (qixiaData && chef.tags) {
            for (var t = 0; t < chef.tags.length; t++) {
                var tag = chef.tags[t];
                if (qixiaData[tag] && qixiaData[tag].GuestApearRate) {
                    result.hasSkills = true;
                    categoryFlags.guestRate = true;
                    result.skillValues.guestRate += qixiaData[tag].GuestApearRate;
                }
            }
        }
        
        if (!result.hasSkills) {
            return result;
        }
        
        // 设置分类标记
        if (chef.specialSkillEffect) {
            for (var i = 0; i < chef.specialSkillEffect.length; i++) {
                var skill = chef.specialSkillEffect[i];
                if (skill.type === 'GuestApearRate') categoryFlags.guestRate = true;
                else if (skill.type === 'GuestDropCount') categoryFlags.crit = true;
                else if (skill.type === 'OpenTime') categoryFlags.time = true;
                else if (skill.type === 'GuestAntiqueDropRate') categoryFlags.rune = true;
            }
        }
        
        if (chef.ultimateSkillEffect) {
            for (var i = 0; i < chef.ultimateSkillEffect.length; i++) {
                var skill = chef.ultimateSkillEffect[i];
                if (skill.type === 'GuestApearRate') categoryFlags.guestRate = true;
                else if (skill.type === 'GuestDropCount') categoryFlags.crit = true;
                else if (skill.type === 'OpenTime' || skill.type === 'CookbookTime') categoryFlags.time = true;
                else if (skill.type === 'GuestAntiqueDropRate') categoryFlags.rune = true;
            }
        }
        
        if (useEquip && chef.equip && chef.equip.effect) {
            for (var i = 0; i < chef.equip.effect.length; i++) {
                var skill = chef.equip.effect[i];
                if (skill.type === 'GuestApearRate') categoryFlags.guestRate = true;
                else if (skill.type === 'GuestDropCount') categoryFlags.crit = true;
                else if (skill.type === 'OpenTime') categoryFlags.time = true;
                else if (skill.type === 'GuestAntiqueDropRate') categoryFlags.rune = true;
            }
        }
        
        if (useAmber && diskSkills.length > 0) {
            for (var i = 0; i < diskSkills.length; i++) {
                var skill = diskSkills[i];
                if (skill.type === 'GuestApearRate') categoryFlags.guestRate = true;
            }
        }
        
        // 计算技能值
        for (var i = 0; i < allSkillSources.length; i++) {
            var source = allSkillSources[i];
            var skill = source.skill;
            
            if (skill.type === 'GuestApearRate') {
                if (skill.value) {
                    result.skillValues.guestRate += skill.value;
                }
            } else if (skill.type === 'GuestDropCount') {
                var desc = source.desc || '';
                if (skill.conditionType === 'PerRank') {
                    var percentMatch = desc.match(/(\d+)%/);
                    if (percentMatch) {
                        var basePercent = parseInt(percentMatch[1]);
                        result.skillValues.crit += basePercent * 3;
                    }
                } else {
                    var percentMatch = desc.match(/稀有客人赠礼数量(\d+)%/);
                    if (percentMatch) {
                        var basePercent = parseInt(percentMatch[1]);
                        var multiplier = (skill.value || 100) / 100;
                        result.skillValues.crit += basePercent * multiplier;
                    }
                }
            } else if (skill.type === 'GuestAntiqueDropRate') {
                if (source.type === 'chef' || source.type === 'ultimate') {
                    if (skill.value) {
                        result.skillValues.rune += skill.value;
                    }
                }
            }
        }
        
        // 心法盘技能
        for (var i = 0; i < diskSkills.length; i++) {
            var skill = diskSkills[i];
            if (skill.type === 'GuestApearRate') {
                if (skill.value) {
                    result.skillValues.guestRate += skill.value;
                }
            }
        }
        
        // 计算时间技能值
        if (categoryFlags.time) {
            var totalTimeAddition = 0;
            
            if (chef.specialSkillEffect && typeof getTimeAddition === 'function') {
                totalTimeAddition += getTimeAddition(chef.specialSkillEffect);
            }
            
            if (isUltimated && chef.ultimateSkillEffect && typeof getTimeAddition === 'function') {
                totalTimeAddition += getTimeAddition(chef.ultimateSkillEffect);
            }
            
            if (useEquip && chef.equip && chef.equip.effect && typeof getTimeAddition === 'function') {
                var equipEffect = chef.equip.effect;
                if (typeof updateEquipmentEffect === 'function') {
                    equipEffect = updateEquipmentEffect(chef.equip.effect, chef.selfUltimateEffect || []);
                }
                totalTimeAddition += getTimeAddition(equipEffect);
            }
            
            result.skillValues.time = totalTimeAddition;
        }
        
        // 生成分类字符串
        var categories = [];
        if (categoryFlags.guestRate) categories.push('guest-rate-category');
        if (categoryFlags.crit) categories.push('crit-category');
        if (categoryFlags.time) categories.push('time-category');
        if (categoryFlags.rune) categories.push('rune-category');
        result.categories = categories.join(' ');
        
        return result;
    }
    
    // 全局变量：保存当前选中的分类，每种选择框类型独立保存
    var globalChefCategory = null;
    var globalEquipCategory = null;
    var globalRecipeCategory = null;
    
    // 全局变量：保存符文分组的展开/收起状态
    var runeGroupExpandState = {};
    
    /**
     * 初始化厨师或厨具选择框的分类标签
     * @public
     * @param {string} selectorType - 选择器类型：'chef'、'equip' 或 'recipe'
     */
    function initChefCategoryTabs(selectorType) {
        selectorType = selectorType || 'chef'; // 默认为厨师
        
        var selector = '';
        if (selectorType === 'chef') {
            selector = "select.select-picker-chef";
        } else if (selectorType === 'equip') {
            selector = "select.select-picker-equip";
        } else if (selectorType === 'recipe') {
            selector = "select.select-picker-recipe";
        }
        
        $(selector).on("shown.bs.select", function() {
            // 碰瓷查询模式下不添加分类标签
            var isPengciMode = $("#chk-guest-query-mode").prop("checked");
            if (!isGuestRateMode() || isPengciMode) {
                $(this).parent().find('.dropdown-menu .chef-category-tabs, .dropdown-menu .equip-category-tabs, .dropdown-menu .recipe-category-tabs').remove();
                return;
            }
            
            var $select = $(this);
            var selectId = $select.attr('id') || (selectorType + '-select-' + Math.random());
            $select.attr('id', selectId);
            
            var sp = $select.data('selectpicker');
            var $dropdown = sp && sp.$menu ? sp.$menu : $select.parent().find('.dropdown-menu');
            
            // 每次打开时都保存当前的 option HTML（获取最新数据）
            var currentOptionsHtml = $select.html();
            
            // 记录初始顺序
            $select.find('option').each(function(idx) {
                var $opt = $(this);
                if ($opt.attr('data-orig-order') === undefined) {
                    $opt.attr('data-orig-order', String(idx));
                }
            });
            
            // 根据类型创建不同的分类标签
            var tabsClass = selectorType + '-category-tabs';
            var tabsHtml = '';
            
            if (selectorType === 'chef') {
                // 厨师：贵客、暴击、时间、符文、全部
                tabsHtml = '<ul class="nav nav-tabs ' + tabsClass + '">' +
                    '<li class="active"><a href="#" class="tab-guest" data-category="guest-rate-category">贵客</a></li>' +
                    '<li><a href="#" class="tab-crit" data-category="crit-category">暴击</a></li>' +
                    '<li><a href="#" class="tab-time" data-category="time-category">时间</a></li>' +
                    '<li><a href="#" class="tab-rune" data-category="rune-category">符文</a></li>' +
                    '<li><a href="#" class="tab-all">全部</a></li>' +
                    '</ul>';
            } else if (selectorType === 'equip') {
                // 厨具：贵客、时间、全部
                tabsHtml = '<ul class="nav nav-tabs ' + tabsClass + '">' +
                    '<li class="active"><a href="#" class="tab-guest" data-category="guest-rate-category">贵客</a></li>' +
                    '<li><a href="#" class="tab-time" data-category="time-category">时间</a></li>' +
                    '<li><a href="#" class="tab-all">全部</a></li>' +
                    '</ul>';
            } else if (selectorType === 'recipe') {
                // 菜谱：金符文、银符文、铜符文、全部
                tabsHtml = '<ul class="nav nav-tabs ' + tabsClass + '">' +
                    '<li class="active"><a href="#" class="tab-gold" data-category="gold-rune-category">金符文</a></li>' +
                    '<li><a href="#" class="tab-silver" data-category="silver-rune-category">银符文</a></li>' +
                    '<li><a href="#" class="tab-bronze" data-category="bronze-rune-category">铜符文</a></li>' +
                    '<li><a href="#" class="tab-all">全部</a></li>' +
                    '</ul>';
            }
            
            // 创建分类标签（如果不存在）
            if (!$dropdown.find('.' + tabsClass).length) {
                var $searchBox = $dropdown.find('.bs-searchbox');
                if ($searchBox.length) {
                    $searchBox.after(tabsHtml);
                } else {
                    $dropdown.prepend(tabsHtml);
                }
            }
            
            // 绑定标签点击事件
            $dropdown.find('.tab-all, .tab-guest, .tab-crit, .tab-time, .tab-rune, .tab-gold, .tab-silver, .tab-bronze').off('click').on('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                
                var $tab = $(this);
                var categoryName = $tab.attr('data-category');
                var sortKey = null;
                
                // 根据标签确定排序键
                if ($tab.hasClass('tab-all')) {
                    sortKey = null;  // 全部标签：不排序
                } else if ($tab.hasClass('tab-guest')) {
                    sortKey = 'guestRate';  // 贵客标签：按 GuestApearRate 排序
                } else if ($tab.hasClass('tab-crit')) {
                    sortKey = 'crit';  // 暴击标签：按 GuestDropCount 排序
                } else if ($tab.hasClass('tab-time')) {
                    sortKey = 'time';  // 时间标签：按 OpenTime 排序
                } else if ($tab.hasClass('tab-rune')) {
                    sortKey = 'rune';  // 符文标签：按 GuestAntiqueDropRate 排序
                } else if ($tab.hasClass('tab-gold') || $tab.hasClass('tab-silver') || $tab.hasClass('tab-bronze')) {
                    sortKey = 'recipeTime';  // 符文分类：按时间排序
                }
                
                // 更新标签状态
                $tab.parent().addClass('active').siblings().removeClass('active');
                
                // 菜谱使用特殊的过滤函数
                if (selectorType === 'recipe') {
                    filterAndSortRecipes($select, currentOptionsHtml, categoryName === 'all' ? null : categoryName, sortKey);
                } else {
                    // 厨师和厨具使用通用的过滤函数
                    filterAndSortChefs($select, currentOptionsHtml, categoryName === 'all' ? null : categoryName, sortKey, selectorType);
                }
                
                return false;
            });
            
            // 立即应用保存的分类，避免闪动
            // 根据选择框类型获取对应的全局变量
            var categoryToApply = null;
            if (selectorType === 'chef') {
                categoryToApply = globalChefCategory;
            } else if (selectorType === 'equip') {
                categoryToApply = globalEquipCategory;
            } else if (selectorType === 'recipe') {
                categoryToApply = globalRecipeCategory;
            }
            
            if (categoryToApply) {
                // 恢复标签选中状态
                $dropdown.find('.' + tabsClass + ' li').removeClass('active');
                
                if (categoryToApply.category === null) {
                    $dropdown.find('.tab-all').parent().addClass('active');
                } else {
                    var $targetTab = $dropdown.find('.' + tabsClass + ' a[data-category="' + categoryToApply.category + '"]');
                    if ($targetTab.length) {
                        $targetTab.parent().addClass('active');
                    } else {
                        $dropdown.find('.tab-all').parent().addClass('active');
                        categoryToApply = {category: null, sortKey: null};
                    }
                }
                
                if (selectorType === 'recipe') {
                    filterAndSortRecipes($select, currentOptionsHtml, categoryToApply.category, categoryToApply.sortKey);
                } else {
                    filterAndSortChefs($select, currentOptionsHtml, categoryToApply.category, categoryToApply.sortKey, selectorType);
                }
            } else {
                // 初始化时根据选择框类型设置默认分类
                var defaultCategory = null;
                var defaultSortKey = null;
                
                if (selectorType === 'chef') {
                    // 厨师默认选择"贵客"
                    defaultCategory = 'guest-rate-category';
                    defaultSortKey = 'guestRate';
                    $dropdown.find('.tab-guest').parent().addClass('active');
                } else if (selectorType === 'equip') {
                    // 厨具默认选择"贵客"
                    defaultCategory = 'guest-rate-category';
                    defaultSortKey = 'guestRate';
                    $dropdown.find('.tab-guest').parent().addClass('active');
                } else if (selectorType === 'recipe') {
                    // 菜谱默认选择"金符文"
                    defaultCategory = 'gold-rune-category';
                    defaultSortKey = 'recipeTime';
                    $dropdown.find('.tab-gold').parent().addClass('active');
                }
                
                if (selectorType === 'recipe') {
                    filterAndSortRecipes($select, currentOptionsHtml, defaultCategory, defaultSortKey);
                } else {
                    filterAndSortChefs($select, currentOptionsHtml, defaultCategory, defaultSortKey, selectorType);
                }
            }
        });
    }
    
    /**
     * 过滤和排序菜谱列表（菜谱专用）
     * @private
     * @param {jQuery} $select - 选择框对象
     * @param {string} originalHtml - 原始的 option HTML
     * @param {string} categoryName - 分类名称
     * @param {string} sortKey - 排序键
     */
    function filterAndSortRecipes($select, originalHtml, categoryName, sortKey) {
        // 保存当前选中的分类到菜谱专用全局变量
        globalRecipeCategory = {category: categoryName, sortKey: sortKey};
        
        var sp = $select.data('selectpicker');
        if (!sp) return;
        
        // 保存当前选中的值
        var currentValue = $select.val();
        
        // 保存当前的搜索关键词
        var $searchInput = sp.$menu.find('.bs-searchbox input');
        var searchKeyword = $searchInput.length ? $searchInput.val() : '';
        
        // 1) 恢复原始的 option 列表
        $select.html(originalHtml);
        
        // 2) 过滤：移除不符合分类的 option
        if (categoryName) {
            $select.find('option').each(function() {
                var $opt = $(this);
                var cat = $opt.attr('data-category') || '';
                
                // 保留占位项
                if ($opt.val() === "" || $opt.val() === null || $opt.text().trim() === "") {
                    return;
                }
                
                // 检查是否匹配分类
                var shouldShow = cat && cat.indexOf(categoryName) >= 0;
                if (!shouldShow) {
                    $opt.remove();
                }
            });
        }
        
        // 3) 排序和分组
        if (sortKey === 'recipeTime') {
            // 菜谱按符文分组 + 时间升序排序
            var runeList = [];
            if (categoryName === 'gold-rune-category') {
                runeList = GOLD_RUNES;
            } else if (categoryName === 'silver-rune-category') {
                runeList = SILVER_RUNES;
            } else if (categoryName === 'bronze-rune-category') {
                runeList = BRONZE_RUNES;
            }
            
            var $options = $select.find('option');
            var placeholders = [];
            var recipesByRune = {}; // 按符文分组的菜谱
            
            $options.each(function() {
                var $opt = $(this);
                var isPlaceholder = ($opt.val() === "" || $opt.val() === null || $opt.text().trim() === "");
                
                if (isPlaceholder) {
                    placeholders.push($opt);
                } else {
                    var runeName = $opt.attr('data-rune-name') || '';
                    if (!recipesByRune[runeName]) {
                        recipesByRune[runeName] = [];
                    }
                    recipesByRune[runeName].push($opt);
                }
            });
            
            // 清空选择框
            $select.empty();
            
            // 添加占位项
            for (var i = 0; i < placeholders.length; i++) {
                $select.append(placeholders[i]);
            }
            
            // 按符文顺序添加分组
            for (var r = 0; r < runeList.length; r++) {
                var runeName = runeList[r];
                var recipes = recipesByRune[runeName];
                
                if (recipes && recipes.length > 0) {
                    // 按时间排序该符文下的菜谱
                    recipes.sort(function(a, b) {
                        var aTime = Number($(a).attr('data-time') || 999999);
                        var bTime = Number($(b).attr('data-time') || 999999);
                        if (aTime !== bTime) return aTime - bTime;
                        return Number($(a).attr('data-orig-order') || 0) - Number($(b).attr('data-orig-order') || 0);
                    });
                    
                    // 创建 optgroup，标签包含菜谱数量
                    var labelWithCount = runeName + ' (' + recipes.length + ')';
                    var $optgroup = $('<optgroup label="' + labelWithCount + '"></optgroup>');
                    for (var j = 0; j < recipes.length; j++) {
                        $optgroup.append(recipes[j]);
                    }
                    $select.append($optgroup);
                }
            }
            
            // 添加不在列表中的符文（如果有）
            for (var runeName in recipesByRune) {
                if (runeList.indexOf(runeName) === -1) {
                    var recipes = recipesByRune[runeName];
                    recipes.sort(function(a, b) {
                        var aTime = Number($(a).attr('data-time') || 999999);
                        var bTime = Number($(b).attr('data-time') || 999999);
                        if (aTime !== bTime) return aTime - bTime;
                        return Number($(a).attr('data-orig-order') || 0) - Number($(b).attr('data-orig-order') || 0);
                    });
                    
                    // 创建 optgroup，标签包含菜谱数量
                    var labelWithCount = runeName + ' (' + recipes.length + ')';
                    var $optgroup = $('<optgroup label="' + labelWithCount + '"></optgroup>');
                    for (var j = 0; j < recipes.length; j++) {
                        $optgroup.append(recipes[j]);
                    }
                    $select.append($optgroup);
                }
            }
        } else if (!categoryName) {
            // 不排序且显示全部：恢复原始顺序
            var opts = $select.find('option').toArray();
            opts.sort(function(a, b) {
                return Number($(a).attr('data-orig-order') || 0) - Number($(b).attr('data-orig-order') || 0);
            });
            $select.empty().append(opts);
        }
        
        // 4) 恢复选中的值（先检查值是否有效）
        if (currentValue && currentValue !== "" && $select.find('option[value="' + currentValue + '"]').length > 0) {
            $select.val(currentValue);
        } else {
            // 如果值无效，不设置值，让selectpicker自动处理
            // 不调用 $select.val("") 避免触发错误
        }
        
        // 5) 刷新 selectpicker
        sp.refresh();
        
        // 修复 bootstrap-select 的 bug：使用 optgroup 时，最后一个分组的最后一个选项会被错误地标记为 selected/disabled
        if (sortKey === 'recipeTime') {
            // 使用之前保存的 currentValue 作为真正选中的值
            var realSelectedValue = currentValue;
            
            // 修复 DOM 中的样式
            if (sp.$menu) {
                var $innerMenu = sp.$menu.find('.dropdown-menu.inner');
                if ($innerMenu.length) {
                    // 找到最后一个真正的选项元素
                    var $lastItem = $innerMenu.find('li a.dropdown-item').last().parent();
                    
                    if ($lastItem.length) {
                        // 获取最后一个选项对应的 option 值
                        var lastOptionValue = null;
                        
                        // 从 selectpicker.current.data 中获取最后一个选项的值
                        if (sp.selectpicker && sp.selectpicker.current && sp.selectpicker.current.data) {
                            var dataArray = sp.selectpicker.current.data;
                            // 找到最后一个 type 为 'option' 的项
                            for (var i = dataArray.length - 1; i >= 0; i--) {
                                if (dataArray[i].type === 'option' && dataArray[i].option) {
                                    lastOptionValue = dataArray[i].option.value;
                                    break;
                                }
                            }
                        }
                        
                        // 第一步：清除所有选项的 selected/active 类（但不清除 disabled）
                        $innerMenu.find('li').removeClass('selected active');
                        $innerMenu.find('li a').removeClass('selected');
                        
                        // 第二步：修复 selectpicker.current.data 中所有选项的 selected 属性
                        // 同时清除 <option> 元素的 selected 属性（这是关键！bootstrap-select 会检查这个属性）
                        if (sp.selectpicker && sp.selectpicker.current && sp.selectpicker.current.data) {
                            var dataArray = sp.selectpicker.current.data;
                            for (var i = 0; i < dataArray.length; i++) {
                                if (dataArray[i].type === 'option' && dataArray[i].option) {
                                    dataArray[i].selected = false;
                                    // 清除 <option> 元素的 selected 属性
                                    if (dataArray[i].option.selected) {
                                        dataArray[i].option.selected = false;
                                    }
                                }
                            }
                        }
                        
                        // 第三步：修复最后一个选项的 disabled 状态
                        // bootstrap-select 的 bug 会错误地将最后一个选项标记为 selected，导致它被禁用
                        // 需要检查最后一个选项是否真的应该被禁用（即它的 <option> 元素是否有 disabled 属性）
                        if (lastOptionValue) {
                            var $lastOption = $select.find('option[value="' + lastOptionValue + '"]');
                            // 清除最后一个选项的 selected 属性
                            if ($lastOption.length) {
                                $lastOption.prop('selected', false);
                            }
                            // 如果最后一个选项的 <option> 元素没有 disabled 属性，则移除 li 的 disabled 类
                            if ($lastOption.length && !$lastOption.prop('disabled')) {
                                $lastItem.removeClass('disabled');
                                $lastItem.find('a').removeClass('disabled');
                                // 同时修复 selectpicker.current.data 中的 disabled 属性
                                if (sp.selectpicker && sp.selectpicker.current && sp.selectpicker.current.data) {
                                    var dataArray = sp.selectpicker.current.data;
                                    for (var i = dataArray.length - 1; i >= 0; i--) {
                                        if (dataArray[i].type === 'option' && dataArray[i].option && dataArray[i].option.value === lastOptionValue) {
                                            dataArray[i].disabled = false;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // 第四步：如果有真正选中的值，为其添加正确的标记
                        if (realSelectedValue && realSelectedValue !== '') {
                            // 在 selectpicker.current.data 中标记真正选中的选项，并找到对应的 li 元素
                            if (sp.selectpicker && sp.selectpicker.current && sp.selectpicker.current.data) {
                                var dataArray = sp.selectpicker.current.data;
                                var $allLis = $innerMenu.find('li');
                                for (var i = 0; i < dataArray.length; i++) {
                                    if (dataArray[i].type === 'option' && dataArray[i].option && dataArray[i].option.value === realSelectedValue) {
                                        dataArray[i].selected = true;
                                        // 设置 <option> 元素的 selected 属性
                                        dataArray[i].option.selected = true;
                                        
                                        // dataArray 的索引直接对应 li 元素的索引
                                        var $targetLi = $allLis.eq(i);
                                        if ($targetLi.length) {
                                            // 添加 selected 和 active 类来显示已选中状态（背景置灰）
                                            $targetLi.addClass('selected active');
                                            $targetLi.find('a').addClass('selected');
                                            // 当前选择框选中的菜谱不应该是 disabled 状态，而是 selected 状态
                                            // 移除 disabled 类，确保显示为"已选择"而不是"不可选"
                                            $targetLi.removeClass('disabled');
                                            $targetLi.find('a').removeClass('disabled');
                                            
                                            // 同时移除 <option> 元素的 disabled 属性（针对当前选择框选中的菜谱）
                                            var $selectedOption = $select.find('option[value="' + realSelectedValue + '"]');
                                            if ($selectedOption.length) {
                                                $selectedOption.prop('disabled', false);
                                                $selectedOption.prop('selected', true);
                                            }
                                            
                                            // 修复 selectpicker.current.data 中的 disabled 属性
                                            dataArray[i].disabled = false;
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 6) 冲突检测和标红贵客（贵客率模式下）
        if (sortKey === 'recipeTime' && typeof GuestRateCalculator !== 'undefined' && GuestRateCalculator.isGuestRateMode()) {
            detectAndMarkConflicts($select, sp, runeList);
        }
        
        // 7) 添加 optgroup 折叠功能（延迟执行，确保修复代码先执行）
        if (sortKey === 'recipeTime') {
            setTimeout(function() {
                addOptgroupCollapseFeature(sp.$menu);
                
            }, 10);
            
            // 监听搜索框输入事件，自动展开包含搜索结果的符文分组
            var $searchInput = sp.$menu.find('.bs-searchbox input');
            if ($searchInput.length) {
                $searchInput.off('input.runeExpand').on('input.runeExpand', function() {
                    var searchText = $(this).val().toLowerCase();
                    
                    if (searchText) {
                        // 有搜索内容时，展开所有包含可见菜谱的符文分组
                        sp.$menu.find('.dropdown-header').each(function() {
                            var $header = $(this);
                            var $options = $header.nextUntil('.dropdown-header', 'li');
                            
                            // 检查该分组下是否有可见的菜谱
                            var hasVisibleOptions = false;
                            $options.each(function() {
                                if ($(this).is(':visible') && !$(this).hasClass('hidden')) {
                                    hasVisibleOptions = true;
                                    return false; // 跳出循环
                                }
                            });
                            
                            // 如果有可见菜谱，展开该分组
                            if (hasVisibleOptions) {
                                var isCollapsed = $header.data('collapsed');
                                if (isCollapsed) {
                                    var $icon = $header.find('.collapse-icon');
                                    $options.show();
                                    $icon.css('transform', 'translateY(-50%) rotate(0deg)');
                                    $header.data('collapsed', false);
                                    
                                    // 更新全局状态
                                    var runeName = $header.data('rune-name');
                                    if (runeName) {
                                        runeGroupExpandState[runeName] = false;
                                    }
                                }
                            }
                        });
                    }
                });
            }
        }
        
        // 7) 重新应用搜索关键词（如果有）
        if (searchKeyword) {
            // 延迟执行，确保 refresh 完成后再应用搜索
            setTimeout(function() {
                var $newSearchInput = sp.$menu.find('.bs-searchbox input');
                if ($newSearchInput.length) {
                    $newSearchInput.val(searchKeyword);
                    // 触发搜索
                    $newSearchInput.trigger('input');
                }
            }, 0);
        }
    }
    
    /**
     * 为 optgroup 添加折叠功能
     * @private
     * @param {jQuery} $dropdown - 下拉菜单对象
     */
    function addOptgroupCollapseFeature($dropdown) {
        // 为每个 optgroup 标签添加折叠功能
        $dropdown.find(".dropdown-header").each(function() {
            var $header = $(this);
            
            // 如果还没有添加折叠图标，则添加
            if (!$header.find(".collapse-icon").length) {
                // 添加可折叠类
                $header.addClass("collapsible");
                
                // 直接设置字体大小为15px
                $header.css('font-size', '15px');
                
                // 使用 glyphicon 箭头样式（和贵客下拉框一致）
                var $icon = $("<span class='collapse-icon glyphicon glyphicon-chevron-right'></span>");
                $header.append($icon);
                
                // 获取符文名称（去掉数量部分）
                var headerText = $header.text().trim();
                var runeName = headerText.replace(/\s*\(\d+\)\s*$/, ''); // 移除 "(数量)" 部分
                
                // 检查是否有保存的展开状态
                var isCollapsed = true;
                if (runeGroupExpandState.hasOwnProperty(runeName)) {
                    isCollapsed = runeGroupExpandState[runeName];
                } else {
                    // 默认收起状态
                    runeGroupExpandState[runeName] = true;
                }
                
                // 设置初始状态
                $header.data("collapsed", isCollapsed);
                $header.data("rune-name", runeName);
                
                if (isCollapsed) {
                    // 收起状态 - 向右箭头
                    $header.nextUntil(".dropdown-header", "li").hide();
                } else {
                    // 展开状态 - 向下箭头
                    $icon.removeClass("glyphicon-chevron-right").addClass("glyphicon-chevron-down");
                    $icon.css("color", "#337ab7");
                    $header.nextUntil(".dropdown-header", "li").show();
                }
            }
            
            // 点击标题切换折叠状态
            $header.off("click").on("click", function(e) {
                e.stopPropagation();
                e.preventDefault();
                
                var $this = $(this);
                var isCollapsed = $this.data("collapsed");
                var runeName = $this.data("rune-name");
                var $icon = $this.find(".collapse-icon");
                
                // 找到该 optgroup 下的所有选项
                var $options = $this.nextUntil(".dropdown-header", "li");
                
                if (isCollapsed) {
                    // 展开 - 切换为向下箭头
                    $options.slideDown(200);
                    $icon.removeClass("glyphicon-chevron-right").addClass("glyphicon-chevron-down");
                    $icon.css("color", "#337ab7");
                    $this.data("collapsed", false);
                    // 保存展开状态
                    runeGroupExpandState[runeName] = false;
                } else {
                    // 收起 - 切换为向右箭头
                    $options.slideUp(200);
                    $icon.removeClass("glyphicon-chevron-down").addClass("glyphicon-chevron-right");
                    $icon.css("color", "#999");
                    $this.data("collapsed", true);
                    // 保存收起状态
                    runeGroupExpandState[runeName] = true;
                }
            });
        });
        
        // 修复 bootstrap-select 的 bug：最后一个分组的最后一个选项可能被错误标记
        // 注意：只移除 disabled 类，不移除 selected 类（因为可能是真正选中的）
        var $innerMenu = $dropdown.find('.dropdown-menu.inner');
        if ($innerMenu.length) {
            var $lastItem = $innerMenu.find('li a.dropdown-item').last().parent();
            if ($lastItem.length) {
                // 只移除 disabled 类
                $lastItem.removeClass('disabled');
                $lastItem.find('a').removeClass('disabled');
            }
        }
    }
    
    /**
     * 检测并标记菜谱选择框中的贵客冲突
     * @private
     * @param {jQuery} $select - 选择框对象
     * @param {Object} sp - selectpicker 实例
     * @param {Array} runeList - 符文列表
     */
    /**
     * 检测并标记选择框中的贵客冲突
     * @private
     * @param {jQuery} $select - 选择框对象
     * @param {Object} sp - selectpicker 对象
     * @param {Array} runeList - 符文列表
     * @param {Object} gameData - 游戏数据对象（可选，如果不传则从 calCustomRule.gameData 获取）
     */
    function detectAndMarkConflicts($select, sp, runeList, gameData) {
        
        // 获取游戏数据：优先使用传入的参数，否则从 calCustomRule.gameData 获取
        if (!gameData) {
            gameData = typeof calCustomRule !== 'undefined' && calCustomRule.gameData ? calCustomRule.gameData : null;
        }
        if (!gameData || !gameData.guests) {
            return;
        }
        var $dropdown = sp.$menu;
        var $innerMenu = sp.$menuInner || $dropdown.find('ul.inner');
        
        // 获取当前选择框已选择的菜谱
        var currentSelectedRecipe = null;
        var currentValue = $select.val();
        if (currentValue) {
            // 从 option 中获取菜谱名称
            var $currentOption = $select.find('option[value="' + currentValue + '"]');
            if ($currentOption.length > 0) {
                var currentOptionText = $currentOption.text().trim();
                currentSelectedRecipe = currentOptionText.replace(/\s*\([^)]+\)\s*/g, '').trim();
            }
        }
        
        // 收集场上已选择的菜谱（用于判断冲突）
        // 注意：排除当前选择框自己已选择的菜谱
        var selectedRecipesOnField = [];
        if (calCustomRule && calCustomRule.rules && calCustomRule.rules.length > 0) {
            for (var ruleIdx = 0; ruleIdx < calCustomRule.rules.length; ruleIdx++) {
                var rule = calCustomRule.rules[ruleIdx];
                if (rule && rule.custom) {
                    for (var c in rule.custom) {
                        for (var r in rule.custom[c].recipes) {
                            if (rule.custom[c].recipes[r].data) {
                                var recipeName = rule.custom[c].recipes[r].data.name;
                                // 排除当前选择框自己已选择的菜谱
                                if (recipeName !== currentSelectedRecipe) {
                                    selectedRecipesOnField.push({
                                        recipeName: recipeName,
                                        recipeId: rule.custom[c].recipes[r].data.recipeId
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        // 收集所有菜谱的贵客信息
        var guestToRecipesMap = {};  // 贵客 -> 菜谱列表的映射（全局）
        var guestToRunesMap = {};    // 贵客 -> 符文列表的映射
        var sameRuneConflictGuests = {};  // 同一符文内冲突的贵客：{符文名: [贵客列表]}
        var crossRuneConflictGuests = [];  // 跨符文冲突的贵客
        
        // 遍历每个符文分组
        runeList.forEach(function(runeName) {
            var guestToRecipesInRune = {};  // 当前符文内的贵客 -> 菜谱映射
            
            // 遍历该符文下的所有菜谱
            $select.find('option[data-rune-name="' + runeName + '"]').each(function() {
                var $opt = $(this);
                var optionText = $opt.text().trim();
                
                // 从 option text 中提取菜谱名（移除括号中的贵客信息）
                var recipeName = optionText.replace(/\s*\([^)]+\)\s*/g, '').trim();
                
                // 从贵客数据中查找该菜谱对应的贵客
                gameData.guests.forEach(function(guest) {
                    if (guest.gifts) {
                        guest.gifts.forEach(function(gift) {
                            if (gift.recipe === recipeName && gift.antique === runeName) {
                                var guestName = guest.name;
                                // 全局映射
                                if (!guestToRecipesMap[guestName]) {
                                    guestToRecipesMap[guestName] = [];
                                }
                                if (guestToRecipesMap[guestName].indexOf(recipeName) === -1) {
                                    guestToRecipesMap[guestName].push(recipeName);
                                }
                                // 符文映射
                                if (!guestToRunesMap[guestName]) {
                                    guestToRunesMap[guestName] = [];
                                }
                                if (guestToRunesMap[guestName].indexOf(runeName) === -1) {
                                    guestToRunesMap[guestName].push(runeName);
                                }
                                // 当前符文内映射
                                if (!guestToRecipesInRune[guestName]) {
                                    guestToRecipesInRune[guestName] = [];
                                }
                                if (guestToRecipesInRune[guestName].indexOf(recipeName) === -1) {
                                    guestToRecipesInRune[guestName].push(recipeName);
                                }
                            }
                        });
                    }
                });
            });
            
            // 检测当前符文内的冲突
            Object.keys(guestToRecipesInRune).forEach(function(guestName) {
                if (guestToRecipesInRune[guestName].length > 1) {
                    if (!sameRuneConflictGuests[runeName]) {
                        sameRuneConflictGuests[runeName] = [];
                    }
                    sameRuneConflictGuests[runeName].push(guestName);
                }
            });
        });
        
        // 检测跨符文冲突
        Object.keys(guestToRunesMap).forEach(function(guestName) {
            if (guestToRunesMap[guestName].length > 1) {
                crossRuneConflictGuests.push(guestName);
            }
        });
        
        // 找出与场上菜谱有冲突的贵客
        var fieldConflictGuests = [];
        selectedRecipesOnField.forEach(function(selectedRecipe) {
            gameData.guests.forEach(function(guest) {
                if (guest.gifts) {
                    guest.gifts.forEach(function(gift) {
                        if (gift.recipe === selectedRecipe.recipeName) {
                            if (fieldConflictGuests.indexOf(guest.name) === -1) {
                                fieldConflictGuests.push(guest.name);
                            }
                        }
                    });
                }
            });
        });
        
        // 标记冲突贵客（在下拉菜单的 li 元素中）
        $innerMenu.find('li').each(function() {
            var $li = $(this);
            if ($li.hasClass('divider') || $li.hasClass('disabled') || $li.hasClass('hidden')) return;
            
            var $link = $li.find('a');
            var $text = $link.find('.text');
            
            if ($text.length === 0) return;
            
            // 从 text 内容中提取贵客名称（在括号中）
            var fullText = $text.html();
            var regex = /\(([^)]+)\)/;
            var match = fullText.match(regex);
            
            if (!match) return;
            
            var guestsInParentheses = match[1];  // 括号中的贵客名称
            var guestArray = guestsInParentheses.split('、');
            
            // 从 <span class='name'> 中提取菜谱名
            var $nameSpan = $text.find('.name');
            var recipeName = '';
            if ($nameSpan.length > 0) {
                recipeName = $nameSpan.text().trim();
            } else {
                // 降级方案：如果找不到 .name，从文本中提取
                var liText = $text.text().trim();
                recipeName = liText.replace(/\s*\([^)]+\)\s*/g, '').trim();
                // 移除可能的技法信息（如"炒98炒40"）
                var skillMatch = recipeName.match(/^([^\d]+)/);
                if (skillMatch) {
                    recipeName = skillMatch[1].trim();
                }
            }
            
            // 查找对应的 option 来获取符文名称
            var runeName = '';
            $select.find('option').each(function() {
                var $opt = $(this);
                
                // 跳过没有符文名称的 option
                if (!$opt.attr('data-rune-name')) {
                    return true;  // continue
                }
                
                // 方法1: 从 data-content 属性中提取菜谱名
                var optRecipeName = '';
                var dataContent = $opt.attr('data-content');
                if (dataContent) {
                    var $tempDiv = $('<div>').html(dataContent);
                    var $optNameSpan = $tempDiv.find('.name');
                    if ($optNameSpan.length > 0) {
                        optRecipeName = $optNameSpan.text().trim();
                    }
                }
                
                // 方法2: 如果方法1失败，从 option 的 display 属性获取
                if (!optRecipeName) {
                    var optData = $opt.data();
                    if (optData && optData.display) {
                        optRecipeName = optData.display;
                    }
                }
                
                // 方法3: 如果前两个方法都失败，从 text 中提取
                if (!optRecipeName) {
                    var optText = $opt.text().trim();
                    optRecipeName = optText.replace(/\s*\([^)]+\)\s*/g, '').trim();
                    // 移除可能的技法信息
                    var skillMatch = optRecipeName.match(/^([^\d]+)/);
                    if (skillMatch) {
                        optRecipeName = skillMatch[1].trim();
                    }
                }
                
                if (optRecipeName === recipeName) {
                    runeName = $opt.attr('data-rune-name');
                    return false;  // 找到就退出循环
                }
            });
            
            if (!runeName) {
                return;
            }
            
            // 为每个贵客应用颜色标记
            var guestHtml = guestArray.map(function(guestName) {
                guestName = guestName.trim();
                
                var isFieldConflict = fieldConflictGuests.indexOf(guestName) !== -1;
                var isSameRuneConflict = sameRuneConflictGuests[runeName] && 
                                        sameRuneConflictGuests[runeName].indexOf(guestName) !== -1;
                var isCrossRuneConflict = crossRuneConflictGuests.indexOf(guestName) !== -1;
                // 检查是否与场上菜谱冲突（优先级最高，红色加粗）
                if (isFieldConflict) {
                    return '<span style="color: red; font-weight: bold;">' + guestName + '</span>';
                }
                // 检查是否在同一符文内有冲突（红色）
                if (isSameRuneConflict) {
                    return '<span style="color: red;">' + guestName + '</span>';
                }
                // 检查是否跨符文冲突（橙色）
                if (isCrossRuneConflict) {
                    return '<span style="color: #FF8C00;">' + guestName + '</span>';
                }
                // 无冲突
                return guestName;
            }).join('、');
            
            // 更新显示：只修改括号中的贵客名称颜色
            var newText = fullText.replace(regex, '(' + guestHtml + ')');
            $text.html(newText);
        });
    }
    
    /**
     * 检测场上已选择菜谱的贵客冲突
     * @private
     * @param {number} ruleIndex - 规则索引
     * @param {Object} gameData - 游戏数据对象（包含 guests 等信息）
     * @returns {Array} 冲突信息数组，每个元素包含 {guestName, recipes}
     */
    function checkGuestConflictsForSelectedRecipes(ruleIndex, gameData) {
        if (!isGuestRateMode()) {
            return [];
        }
        if (!gameData || !gameData.guests) {
            return [];
        }
        if (typeof calCustomRule === 'undefined' || !calCustomRule.rules || !calCustomRule.rules[ruleIndex]) {
            return [];
        }
        var rule = calCustomRule.rules[ruleIndex];
        if (!rule.custom) {
            return [];
        }
        var custom = rule.custom;
        
        // 收集所有已上场的菜谱
        var selectedRecipes = [];
        for (var c in custom) {
            for (var r in custom[c].recipes) {
                if (custom[c].recipes[r].data) {
                    selectedRecipes.push({
                        recipeName: custom[c].recipes[r].data.name,
                        recipeId: custom[c].recipes[r].data.recipeId,
                        itemIndex: c,
                        recipeIndex: r
                    });
                }
            }
        }
        
        
        // 按贵客分组
        var recipesByGuest = {};
        
        selectedRecipes.forEach(function(recipeInfo) {
            // 从贵客数据中查找该菜谱对应的贵客
            gameData.guests.forEach(function(guest) {
                if (guest.gifts) {
                    guest.gifts.forEach(function(gift) {
                        if (gift.recipe === recipeInfo.recipeName) {
                            if (!recipesByGuest[guest.name]) {
                                recipesByGuest[guest.name] = [];
                            }
                            // 避免重复添加
                            var alreadyAdded = recipesByGuest[guest.name].some(function(item) {
                                return item.recipeName === recipeInfo.recipeName;
                            });
                            if (!alreadyAdded) {
                                recipesByGuest[guest.name].push(recipeInfo);
                            }
                        }
                    });
                }
            });
        });
        
        // 检测冲突：如果一个贵客对应多个菜谱，则有冲突
        var conflictRecipes = [];
        var conflictInfo = [];
        
        Object.keys(recipesByGuest).forEach(function(guestName) {
            var guestRecipes = recipesByGuest[guestName];
            
            if (guestRecipes.length > 1) {
                // 添加到冲突信息数组
                conflictInfo.push({
                    guestName: guestName,
                    recipes: guestRecipes.map(function(r) { return r.recipeName; })
                });
                // 多个菜谱有冲突，全部标记为冲突
                guestRecipes.forEach(function(recipeInfo) {
                    conflictRecipes.push(recipeInfo);
                });
            }
        });
        
        // 先清除所有菜谱的冲突标记
        $(".cal-custom-item:eq(" + ruleIndex + ") .selected-item .recipe-box .recipe-box-1 .name").css({
            "color": "",
            "font-weight": ""
        });
        
        // 标记有冲突的菜谱名字为红色
        conflictRecipes.forEach(function(recipeInfo) {
            var selector = ".cal-custom-item:eq(" + ruleIndex + ") .selected-item:eq(" + recipeInfo.itemIndex + ") .recipe-box:eq(" + recipeInfo.recipeIndex + ") .recipe-box-1 .name";
            var $recipeName = $(selector);
            if ($recipeName.length > 0) {
                $recipeName.css({
                    "color": "red",
                    "font-weight": "bold"
                });
            }
        });
        
        return conflictInfo;
    }
    
    /**
     * 刷新菜谱选择框的冲突检测
     * @public
     * @param {jQuery} $select - 选择框对象
     */
    function refreshConflictDetection($select) {
        if (!$select || !$select.length) {
            return;
        }
        
        var sp = $select.data('selectpicker');
        if (!sp || !sp.$menu) {
            return;
        }
        
        // 调用冲突检测函数
        detectAndMarkConflicts($select, sp, ALL_RUNES);
    }
    
    /**
     * 为菜谱选项添加符文和贵客信息
     * @public
     * @param {Object} optionData - 选项数据对象（包含 content, runeName, guestNames 等字段）
     * @param {Object} recipeData - 菜谱数据对象
     * @param {Object} gameData - 游戏数据对象（包含 guests 等信息）
     * @returns {Array} 处理后的选项数组
     */
    function addRuneAndGuestInfoToRecipeOption(optionData, recipeData, gameData) {
        if (!isGuestRateMode() || !gameData || !gameData.guests) {
            return [optionData];
        }
        
        // 收集该菜谱对应的符文和贵客
        var runeName = null;
        var guestNames = [];
        
        for (var guestIdx = 0; guestIdx < gameData.guests.length; guestIdx++) {
            var guest = gameData.guests[guestIdx];
            if (guest.gifts) {
                for (var giftIdx = 0; giftIdx < guest.gifts.length; giftIdx++) {
                    var gift = guest.gifts[giftIdx];
                    if (gift.recipe === recipeData.name && gift.antique) {
                        // 记录符文名称（所有贵客都是同一种符文）
                        if (!runeName) {
                            runeName = gift.antique;
                        }
                        // 收集贵客名称
                        if (guestNames.indexOf(guest.name) === -1) {
                            guestNames.push(guest.name);
                        }
                    }
                }
            }
        }
        
        // 如果没有找到符文，直接返回原选项
        if (!runeName) {
            return [optionData];
        }
        
        // 保存符文和贵客信息
        optionData.runeName = runeName;
        optionData.guestNames = guestNames.join('、');
        optionData.time = recipeData.totalTime || 0;
        
        // 根据符文类型设置分类
        if (GOLD_RUNES.indexOf(runeName) >= 0) {
            optionData.category = 'gold-rune-category';
        } else if (SILVER_RUNES.indexOf(runeName) >= 0) {
            optionData.category = 'silver-rune-category';
        } else if (BRONZE_RUNES.indexOf(runeName) >= 0) {
            optionData.category = 'bronze-rune-category';
        }
        
        return [optionData];
    }
    
    /**
     * 过滤和排序厨师列表
     * @private
     * @param {jQuery} $select - 选择框对象
     * @param {string} originalHtml - 原始的 option HTML
     * @param {string} categoryName - 分类名称
     * @param {string} sortKey - 排序键
     * @param {string} selectorType - 选择框类型：'chef' 或 'equip'
     */
    function filterAndSortChefs($select, originalHtml, categoryName, sortKey, selectorType) {
        // 保存当前选中的分类到对应的全局变量
        if (selectorType === 'equip') {
            globalEquipCategory = {category: categoryName, sortKey: sortKey};
        } else {
            globalChefCategory = {category: categoryName, sortKey: sortKey};
        }
        
        var sp = $select.data('selectpicker');
        if (!sp) return;
        
        // 保存当前选中的值
        var currentValue = $select.val();
        
        // 保存当前的搜索关键词
        var $searchInput = sp.$menu.find('.bs-searchbox input');
        var searchKeyword = $searchInput.length ? $searchInput.val() : '';
        
        // 1) 恢复原始的 option 列表
        $select.html(originalHtml);
        
        // 2) 过滤：移除不符合分类的 option
        if (categoryName) {
            $select.find('option').each(function() {
                var $opt = $(this);
                var cat = $opt.attr('data-category') || '';
                
                // 保留占位项
                if ($opt.val() === "" || $opt.val() === null || $opt.text().trim() === "") {
                    return;
                }
                
                // 检查是否匹配分类
                var shouldShow = cat && cat.indexOf(categoryName) >= 0;
                if (!shouldShow) {
                    $opt.remove();
                }
            });
        }
        
        // 3) 排序
        if (sortKey) {
            var $options = $select.find('option');
            var placeholders = [];
            var others = [];
            
            $options.each(function() {
                var $opt = $(this);
                var isPlaceholder = ($opt.val() === "" || $opt.val() === null || $opt.text().trim() === "");
                
                if (isPlaceholder) {
                    placeholders.push($opt);
                } else {
                    others.push($opt);
                }
            });
            
            others.sort(function(a, b) {
                var av = {};
                var bv = {};
                try { av = JSON.parse($(a).attr('data-skill-values') || "{}"); } catch (e) { av = {}; }
                try { bv = JSON.parse($(b).attr('data-skill-values') || "{}"); } catch (e) { bv = {}; }
                
                var as = Number(av[sortKey] || 0);
                var bs = Number(bv[sortKey] || 0);
                
                // 时间：升序；其它：降序
                if (sortKey === 'time') {
                    // 时间类：先按时间升序（负数越小越好，-10比1靠前），同时间按贵客率降序
                    if (as !== bs) return as - bs;
                    // 同时间按贵客率降序
                    var agr = Number(av.guestRate || 0);
                    var bgr = Number(bv.guestRate || 0);
                    return bgr - agr;
                } else if (sortKey === 'crit') {
                    // 暴击类：先按暴击率降序，同暴击率按贵客率降序
                    var critDiff = bs - as;
                    if (Math.abs(critDiff) > 0.001) return critDiff;
                    // 暴击率相同时，按贵客率降序
                    var agr = Number(av.guestRate || 0);
                    var bgr = Number(bv.guestRate || 0);
                    var grDiff = bgr - agr;
                    if (Math.abs(grDiff) > 0.001) return grDiff;
                } else {
                    // 其他类型：降序
                    var diff = bs - as;
                    if (Math.abs(diff) > 0.001) return diff;
                }
                
                // 次要排序：按稀有度降序
                var ar = Number(av.rarity || 0);
                var br = Number(bv.rarity || 0);
                if (ar !== br) return br - ar;
                
                // 最终排序：按原始顺序
                return Number($(a).attr('data-orig-order') || 0) - Number($(b).attr('data-orig-order') || 0);
            });
            
            $select.empty();
            for (var i = 0; i < placeholders.length; i++) $select.append(placeholders[i]);
            for (var j = 0; j < others.length; j++) $select.append(others[j]);
        } else if (!categoryName) {
            // 不排序且显示全部：恢复原始顺序
            var opts = $select.find('option').toArray();
            opts.sort(function(a, b) {
                return Number($(a).attr('data-orig-order') || 0) - Number($(b).attr('data-orig-order') || 0);
            });
            $select.empty().append(opts);
        }
        
        // 4) 恢复选中的值
        $select.val(currentValue);
        
        // 5) 刷新 selectpicker
        sp.refresh();
        
        // 5.1) 修复 bootstrap-select 的 bug：sp.refresh() 后可能错误地标记选项状态
        // 获取当前选择框的位置信息，从 calCustomRule 获取真正选中的值
        var $selectedItem = $select.closest('.selected-item');
        var $calCustomItem = $select.closest('.cal-custom-item');
        var ruleIndex = $(".cal-custom-item").index($calCustomItem);
        var chefIndex = $calCustomItem.find(".selected-item").index($selectedItem);
        
        // 从 calCustomRule 获取真正选中的ID
        var realSelectedId = null;
        if (typeof calCustomRule !== 'undefined' && calCustomRule && calCustomRule.rules && calCustomRule.rules[ruleIndex] && 
            calCustomRule.rules[ruleIndex].custom && calCustomRule.rules[ruleIndex].custom[chefIndex]) {
            if (selectorType === 'chef' && calCustomRule.rules[ruleIndex].custom[chefIndex].chef) {
                realSelectedId = calCustomRule.rules[ruleIndex].custom[chefIndex].chef.chefId;
            } else if (selectorType === 'equip' && calCustomRule.rules[ruleIndex].custom[chefIndex].equip) {
                realSelectedId = calCustomRule.rules[ruleIndex].custom[chefIndex].equip.equipId;
            }
            if (realSelectedId) {
                realSelectedId = String(realSelectedId);
            }
        }
        
        // 为当前选择框选中的项添加正确的 selected 标记，移除 disabled 标记
        if (sp.$menu && realSelectedId) {
            var $innerMenu = sp.$menu.find('.dropdown-menu.inner');
            if ($innerMenu.length) {
                // 第一步：清除所有选项的 selected/active 类（但不清除 disabled）
                $innerMenu.find('li').removeClass('selected active');
                $innerMenu.find('li a').removeClass('selected');
                
                // 第二步：修复 selectpicker.current.data 中所有选项的 selected 属性
                if (sp.selectpicker && sp.selectpicker.current && sp.selectpicker.current.data) {
                    var dataArray = sp.selectpicker.current.data;
                    for (var i = 0; i < dataArray.length; i++) {
                        if (dataArray[i].type === 'option' && dataArray[i].option) {
                            dataArray[i].selected = false;
                        }
                    }
                    
                    // 第三步：为真正选中的项添加正确的标记
                    var $allLis = $innerMenu.find('li');
                    for (var i = 0; i < dataArray.length; i++) {
                        if (dataArray[i].type === 'option' && dataArray[i].option) {
                            if (String(dataArray[i].option.value) === String(realSelectedId)) {
                                dataArray[i].selected = true;
                                
                                // dataArray 的索引直接对应 li 元素的索引
                                var $targetLi = $allLis.eq(i);
                                if ($targetLi.length) {
                                    // 添加 selected 和 active 类来显示已选中状态（背景置灰）
                                    $targetLi.addClass('selected active');
                                    $targetLi.find('a').addClass('selected');
                                    // 当前选择框选中的项不应该是 disabled 状态，而是 selected 状态
                                    $targetLi.removeClass('disabled');
                                    $targetLi.find('a').removeClass('disabled');
                                    
                                    // 同时移除 <option> 元素的 disabled 属性
                                    var $selectedOption = $select.find('option[value="' + realSelectedId + '"]');
                                    if ($selectedOption.length) {
                                        $selectedOption.prop('disabled', false);
                                    }
                                    
                                    // 修复 selectpicker.current.data 中的 disabled 属性
                                    dataArray[i].disabled = false;
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        // 6) 重新应用搜索关键词（如果有）
        if (searchKeyword) {
            // 延迟执行，确保 refresh 完成后再应用搜索
            setTimeout(function() {
                var $newSearchInput = sp.$menu.find('.bs-searchbox input');
                if ($newSearchInput.length) {
                    $newSearchInput.val(searchKeyword);
                    // 触发搜索
                    $newSearchInput.trigger('input');
                }
            }, 0);
        }
    }
    
    /**
     * 清空厨师选项缓存（占位函数）
     * 这个函数不需要做任何事情，只是为了保持接口兼容性
     * @public
     */
    function clearChefOptionsCache() {
    }
    
    /**
     * 显示贵客冲突提示
     * 在 .selected-sum 区域显示贵客冲突信息
     * @public
     * @param {number} ruleIndex - 规则索引
     * @param {Object} gameData - 游戏数据对象（可选，如果不传则从 calCustomRule.gameData 获取）
     */
    function displayGuestConflictWarning(ruleIndex, gameData) {
        if (!isGuestRateMode()) {
            return;
        }
        
        // 如果 gameData 参数为空，使用之前保存的 gameData
        var gameDataToUse = gameData || (typeof calCustomRule !== 'undefined' ? calCustomRule.gameData : null);
        
        var conflictInfo = checkGuestConflictsForSelectedRecipes(ruleIndex, gameDataToUse);
        
        if (conflictInfo && conflictInfo.length > 0) {
            var conflictHtml = "<div style='color:red; margin-top: 5px;'>";
            conflictHtml += "<span style='display: inline-block; vertical-align: top;'>冲突提示：</span>";
            conflictHtml += "<span style='display: inline-block;'>";
            conflictInfo.forEach(function(conflict, index) {
                if (index > 0) conflictHtml += "<br>";
                conflictHtml += conflict.guestName + "（" + conflict.recipes.join("、") + "）";
            });
            conflictHtml += "</span>";
            conflictHtml += "</div>";
            $(".cal-custom-item:eq(" + ruleIndex + ") .selected-sum").append(conflictHtml);
        }
    }
    
    /**
     * 刷新所有菜谱选择框的冲突检测
     * 遍历所有菜谱选择框，重新触发冲突检测
     * @public
     */
    function refreshAllRecipeConflictDetection() {
        if (!isGuestRateMode()) {
            return;
        }
        
        // 遍历所有菜谱选择框，重新触发冲突检测
        $('.cal-custom-item .recipe-box select').each(function() {
            var $select = $(this);
            if ($select.data('selectpicker')) {
                refreshConflictDetection($select);
            }
        });
    }
    
    /**
     * 获取按分类筛选和排序后的厨师列表
     * @public
     * @param {Array} chefs - 厨师数组
     * @param {string} categoryType - 分类类型：'guest'(贵客), 'crit'(暴击), 'time'(时间), 'rune'(符文)
     * @param {boolean} onlyShowOwned - 是否只显示已拥有的厨师
     * @param {Object} options - 可选配置 {qixiaData, useEquip, useAmber, localData, configUltimatedIds}
     * @returns {Array} 筛选和排序后的厨师列表，每个元素包含 {chef, skillValues, categories}
     */
    function getFilteredAndSortedChefs(chefs, categoryType, onlyShowOwned, options) {
        if (!chefs || !chefs.length) return [];
        
        options = options || {};
        var qixiaData = options.qixiaData || null;
        var useEquip = options.useEquip !== false;
        var useAmber = options.useAmber !== false;
        var localData = options.localData || null;
        var configUltimatedIds = options.configUltimatedIds || null;
        
        // 分类名称映射
        var categoryMap = {
            'guest': 'guest-rate-category',
            'crit': 'crit-category',
            'time': 'time-category',
            'rune': 'rune-category'
        };
        var targetCategory = categoryMap[categoryType] || 'guest-rate-category';
        
        // 排序键映射
        var sortKeyMap = {
            'guest': 'guestRate',
            'crit': 'crit',
            'time': 'time',
            'rune': 'rune'
        };
        var sortKey = sortKeyMap[categoryType] || 'guestRate';
        
        var result = [];
        
        // 筛选和分析厨师
        for (var i = 0; i < chefs.length; i++) {
            var chef = chefs[i];
            
            // 是否只显示已拥有的厨师
            if (onlyShowOwned && chef.got !== "是") continue;
            
            // 分析厨师技能
            var analysis = analyzeChefGuestRateSkills(
                chef, qixiaData, useEquip, useAmber, localData, configUltimatedIds, 'chef'
            );
            
            // 检查是否属于目标分类
            if (analysis.categories && analysis.categories.indexOf(targetCategory) >= 0) {
                // 时间类厨师额外检查：必须有贵客率技能（GuestApearRate）
                // 如果厨师技能、修炼技能、心法盘、厨具都没有贵客率技能，则排除
                if (categoryType === 'time') {
                    var hasGuestRateSkill = analysis.skillValues.guestRate > 0 || 
                                            (analysis.categories.indexOf('guest-rate-category') >= 0);
                    if (!hasGuestRateSkill) {
                        continue; // 排除没有贵客率技能的时间类厨师
                    }
                }
                
                result.push({
                    chef: chef,
                    skillValues: analysis.skillValues,
                    categories: analysis.categories
                });
            }
        }
        
        // 排序
        result.sort(function(a, b) {
            var av = a.skillValues;
            var bv = b.skillValues;
            
            var as = Number(av[sortKey] || 0);
            var bs = Number(bv[sortKey] || 0);
            
            if (sortKey === 'time') {
                // 时间类：先按星级降序，再按贵客率降序，最后按时间降序（负数越小越好）
                var ar = a.chef.rarity || 0;
                var br = b.chef.rarity || 0;
                if (ar !== br) return br - ar;
                // 贵客率降序
                var agr = Number(av.guestRate || 0);
                var bgr = Number(bv.guestRate || 0);
                var grDiff = bgr - agr;
                if (Math.abs(grDiff) > 0.001) return grDiff;
                // 时间降序（负数越小越好，-30%比-20%好）
                return as - bs;
            } else if (sortKey === 'crit') {
                // 暴击类：先按暴击率降序，同暴击率按贵客率降序
                var critDiff = bs - as;
                if (Math.abs(critDiff) > 0.001) return critDiff;
                // 暴击率相同时，按贵客率降序
                var agr = Number(av.guestRate || 0);
                var bgr = Number(bv.guestRate || 0);
                var grDiff = bgr - agr;
                if (Math.abs(grDiff) > 0.001) return grDiff;
            } else {
                // 其他类型：降序
                var diff = bs - as;
                if (Math.abs(diff) > 0.001) return diff;
            }
            
            // 次要排序：按稀有度降序
            var ar = a.chef.rarity || 0;
            var br = b.chef.rarity || 0;
            if (ar !== br) return br - ar;
            
            return 0;
        });
        
        return result;
    }
    
    // ========================================
    // 碰瓷查询模块
    // ========================================
    
    // 碰瓷贵客选择框当前分类
    var pengciGuestCategory = 'normal';
    
    // 选中的碰瓷菜谱列表（最多9个）
    // 结构: [{guest: "贵客名", recipe: "菜谱名", rank: 2/3/4}]
    // rank: 2=优, 3=特, 4=神
    var selectedPengciRecipes = [];
    var MAX_PENGCI_RECIPES = 9;
    
    /**
     * 根据菜谱名查找已选中的记录
     * @param {string} recipeName - 菜谱名
     * @returns {Object|null} 选中记录或null
     */
    function findSelectedRecipe(recipeName) {
        for (var i = 0; i < selectedPengciRecipes.length; i++) {
            if (selectedPengciRecipes[i].recipe === recipeName) {
                return selectedPengciRecipes[i];
            }
        }
        return null;
    }
    
    /**
     * 获取菜谱在指定贵客下的最低可碰瓷品级
     * @param {string} guestName - 贵客名
     * @param {Object} recipe - 菜谱对象
     * @returns {number|null} 品级(2=优,3=特,4=神)或null(无可碰瓷)
     */
    function getLowestPengciRank(guestName, recipe) {
        if (!recipe.guests || recipe.guests.length === 0) return null;
        
        var currentRank = getPengciRankValue(recipe.rank);
        
        // 遍历优(index=0,rank=2)、特(index=1,rank=3)、神(index=2,rank=4)
        for (var j = 0; j < Math.min(recipe.guests.length, 3); j++) {
            if (recipe.guests[j].guest === guestName) {
                var targetRank = j + 2; // 0->2(优), 1->3(特), 2->4(神)
                // 如果当前品级低于目标品级，说明可以碰瓷
                if (currentRank < targetRank) {
                    return targetRank;
                }
            }
        }
        return null;
    }
    
    // ========================================
    // 碰瓷厨师查询相关函数
    // ========================================
    
    var SKILL_TYPES = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    var SKILL_NAMES = {
        stirfry: '炒',
        boil: '煮',
        knife: '切',
        fry: '炸',
        bake: '烤',
        steam: '蒸'
    };
    
    /**
     * 计算厨师的技法值（考虑厨具、遗玉、修炼等加成）
     * 参考 query.cultivate.js 中的 calculateSkillDiffDetailForGodRecommend 函数
     * @param {Object} chef - 厨师原始数据
     * @param {Object} rule - 规则对象
     * @param {number} chefIndex - 厨师位置索引（0-2），可为null
     * @returns {Object} 包含技法值的厨师副本
     */
    function calculateChefSkillValues(chef, rule, chefIndex) {
        // 获取"已配厨具"和"已配遗玉"复选框状态
        var useEquip = $("#chk-cal-use-equip").prop("checked");
        var useAmber = $("#chk-cal-use-amber").prop("checked");
        
        // 深拷贝厨师数据
        var chefCopy = JSON.parse(JSON.stringify(chef));
        
        if (rule && typeof setDataForChef === 'function') {
            // 确定使用的厨具
            var equipToUse = null;
            if (useEquip && chefCopy.equip) {
                equipToUse = chefCopy.equip;
            }
            
            // 如果不使用已配遗玉，清空遗玉数据
            if (!useAmber && chefCopy.disk && chefCopy.disk.ambers) {
                for (var j = 0; j < chefCopy.disk.ambers.length; j++) {
                    chefCopy.disk.ambers[j].data = null;
                }
            }
            
            // 获取光环加成（使用公共函数，与修炼查询保持一致）
            var partialAdds = null;
            if (typeof getPartialAddsForChef === 'function' && chefIndex !== null && chefIndex !== undefined) {
                partialAdds = getPartialAddsForChef(rule, chefIndex);
            }
            // 如果没有获取到光环加成，使用空数组
            if (!partialAdds) {
                partialAdds = [];
            }
            
            // 调用setDataForChef计算技法值（与calculateSkillDiffDetailForGodRecommend保持一致）
            setDataForChef(
                chefCopy,                           // 厨师
                equipToUse,                         // 厨具（如果勾选了已配厨具）
                true,                               // 是否计算
                rule.calGlobalUltimateData || [],   // 全局修炼数据
                partialAdds,                        // 光环加成
                rule.calSelfUltimateData || [],     // 自身修炼数据
                rule.calActivityUltimateData || [], // 活动修炼数据
                true,                               // 是否使用修炼
                rule,                               // 规则
                useAmber,                           // 是否使用遗玉
                rule.calQixiaData || null           // 奇侠数据
            );
        }
        
        return chefCopy;
    }
    
    /**
     * 检查厨师是否能精确做到菜谱的目标品级
     * @param {Object} chef - 已计算技法值的厨师
     * @param {Object} recipe - 菜谱对象
     * @param {number} targetRank - 目标品级（2=优, 3=特, 4=神）
     * @returns {boolean} 是否精确匹配
     */
    function canChefMakeExactRank(chef, recipe, targetRank) {
        // 检查每种技法是否满足目标品级但不超过下一品级
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            var recipeNeed = recipe[skill] || 0;
            if (recipeNeed > 0) {
                var chefVal = chef[skill + 'Val'] || chef[skill] || 0;
                var requiredForTarget = recipeNeed * targetRank;
                var requiredForNext = recipeNeed * (targetRank + 1);
                
                // 厨师技法值必须 >= 目标品级要求 且 < 下一品级要求
                if (chefVal < requiredForTarget) {
                    return false; // 达不到目标品级
                }
                if (targetRank < 5 && chefVal >= requiredForNext) {
                    return false; // 超过目标品级
                }
            }
        }
        return true;
    }
    
    /**
     * 计算厨师做菜谱能达到的品级
     * @param {Object} chef - 已计算技法值的厨师
     * @param {Object} recipe - 菜谱对象
     * @returns {number} 品级（1=可, 2=优, 3=特, 4=神, 5=传）
     */
    function getChefRecipeRank(chef, recipe) {
        var minRank = 5; // 从传级开始检查
        
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            var recipeNeed = recipe[skill] || 0;
            if (recipeNeed > 0) {
                var chefVal = chef[skill + 'Val'] || chef[skill] || 0;
                
                // 计算该技法能达到的品级
                var skillRank = 1;
                if (chefVal >= recipeNeed * 5) skillRank = 5;
                else if (chefVal >= recipeNeed * 4) skillRank = 4;
                else if (chefVal >= recipeNeed * 3) skillRank = 3;
                else if (chefVal >= recipeNeed * 2) skillRank = 2;
                else skillRank = 1;
                
                if (skillRank < minRank) {
                    minRank = skillRank;
                }
            }
        }
        
        return minRank;
    }
    
    /**
     * 为选中的菜谱查询匹配的厨师组合
     * @returns {Object} 查询结果
     */
    function queryPengciChefConfig() {
        if (selectedPengciRecipes.length === 0) {
            return { success: false, message: '请先选择要碰瓷的菜谱' };
        }
        
        // 获取游戏数据
        var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
            ? calCustomRule.gameData 
            : (typeof CalCustomRule !== 'undefined' && CalCustomRule.gameData ? CalCustomRule.gameData : null);
        
        if (!gameData || !gameData.chefs || !gameData.recipes) {
            return { success: false, message: '游戏数据未加载' };
        }
        
        // 获取规则数据 - 修炼数据在 rules[0] 中
        var rule = null;
        if (typeof calCustomRule !== 'undefined' && calCustomRule.rules && calCustomRule.rules[0]) {
            rule = calCustomRule.rules[0];
        }
        
        if (!rule) {
            return { success: false, message: '规则数据未加载' };
        }
        
        var allChefs = gameData.chefs;
        var allRecipes = gameData.recipes;
        
        // 构建菜谱名到菜谱对象的映射
        var recipeMap = {};
        for (var i = 0; i < allRecipes.length; i++) {
            recipeMap[allRecipes[i].name] = allRecipes[i];
        }
        
        // 获取选中菜谱的详细信息
        var selectedRecipeDetails = [];
        for (var i = 0; i < selectedPengciRecipes.length; i++) {
            var sel = selectedPengciRecipes[i];
            var recipe = recipeMap[sel.recipe];
            if (recipe) {
                selectedRecipeDetails.push({
                    guest: sel.guest,
                    recipe: recipe,
                    recipeName: sel.recipe,
                    targetRank: sel.rank
                });
            }
        }
        
        if (selectedRecipeDetails.length === 0) {
            return { success: false, message: '未找到选中的菜谱数据' };
        }
        
        // Step 1: 为每道菜找出所有能精确匹配的厨师
        var recipeCandidates = []; // [{recipeDetail, candidates: [chefId, ...]}]
        
        // 获取复选框状态
        var useEquip = $("#chk-cal-use-equip").prop("checked");
        var useAmber = $("#chk-cal-use-amber").prop("checked");
        
        // 打印一个已修炼厨师的技法值对比（用于验证修炼加成是否生效）
        for (var debugIdx = 0; debugIdx < allChefs.length; debugIdx++) {
            var debugChef = allChefs[debugIdx];
            if (debugChef.got === "是") {
                if (debugChef.ultimateSkill && debugChef.ultimateSkill.length > 0) {
                    var debugChefCalc = calculateChefSkillValues(debugChef, rule, null);
                    break;
                }
            }
        }
        
        for (var i = 0; i < selectedRecipeDetails.length; i++) {
            var detail = selectedRecipeDetails[i];
            var candidates = [];
            
            for (var j = 0; j < allChefs.length; j++) {
                var chef = allChefs[j];
                // 只考虑已拥有的厨师
                if (chef.got !== "是") continue;
                
                // 计算厨师技法值
                var chefWithSkills = calculateChefSkillValues(chef, rule, null);
                
                // 检查是否能做到目标品级
                var actualRank = getChefRecipeRank(chefWithSkills, detail.recipe);
                
                // 神级(4)是碰瓷的最后一个品级，传级(5)的厨师也可以使用
                var isMatch = false;
                if (detail.targetRank === 4) {
                    // 目标是神级，神级或传级都可以
                    isMatch = (actualRank >= 4);
                } else {
                    // 其他品级必须精确匹配
                    isMatch = (actualRank === detail.targetRank);
                }
                
                if (isMatch) {
                    candidates.push({
                        chefId: chef.chefId,
                        chef: chefWithSkills,
                        chefName: chef.name,
                        actualRank: actualRank,
                        hasEquip: !!(chef.equip && chef.equip.equipId),
                        hasAmber: !!(chef.disk && chef.disk.ambers && chef.disk.ambers.some(function(a) { return a.data; })),
                        hasCultivation: !!(chef.ultimateSkill && chef.ultimateSkill.length > 0)
                    });
                }
            }
            
            recipeCandidates.push({
                detail: detail,
                candidates: candidates
            });
        }
        
        // 检查是否有菜谱没有候选厨师，将其加入未分配列表
        var noChefRecipes = [];
        var validRecipeCandidates = [];
        for (var i = 0; i < recipeCandidates.length; i++) {
            if (recipeCandidates[i].candidates.length === 0) {
                noChefRecipes.push(recipeCandidates[i].detail);
            } else {
                validRecipeCandidates.push(recipeCandidates[i]);
            }
        }
        
        // 如果所有菜谱都没有候选厨师，返回失败
        if (validRecipeCandidates.length === 0) {
            return { 
                success: false, 
                message: '所有菜谱都没有能精确做到目标品级的厨师'
            };
        }
        
        // 使用有候选厨师的菜谱继续处理
        recipeCandidates = validRecipeCandidates;
        
        // Step 2: 优化分配 - 找到使用最少厨师的搭配
        // 构建厨师到可做菜谱的映射
        var chefToRecipes = {}; // chefId -> [recipeIndex, ...]
        var allCandidateChefIds = [];
        
        for (var i = 0; i < recipeCandidates.length; i++) {
            var rc = recipeCandidates[i];
            for (var j = 0; j < rc.candidates.length; j++) {
                var candidate = rc.candidates[j];
                var chefId = candidate.chefId;
                if (!chefToRecipes[chefId]) {
                    chefToRecipes[chefId] = {
                        chef: candidate.chef,
                        chefName: candidate.chefName,
                        chefId: chefId,
                        recipeIndices: []
                    };
                    allCandidateChefIds.push(chefId);
                }
                if (chefToRecipes[chefId].recipeIndices.indexOf(i) < 0) {
                    chefToRecipes[chefId].recipeIndices.push(i);
                }
            }
        }
        
        // 尝试用1个厨师覆盖所有菜谱
        var bestAssignment = null;
        var recipeCount = recipeCandidates.length;
        
        // 尝试1个厨师
        for (var i = 0; i < allCandidateChefIds.length; i++) {
            var chefId = allCandidateChefIds[i];
            var chefData = chefToRecipes[chefId];
            if (chefData.recipeIndices.length >= recipeCount && chefData.recipeIndices.length <= 3) {
                // 检查是否覆盖所有菜谱
                var covered = true;
                for (var r = 0; r < recipeCount; r++) {
                    if (chefData.recipeIndices.indexOf(r) < 0) {
                        covered = false;
                        break;
                    }
                }
                if (covered) {
                    bestAssignment = [{
                        chefId: chefData.chefId,
                        chef: chefData.chef,
                        chefName: chefData.chefName,
                        recipes: recipeCandidates.map(function(rc) { return rc.detail; })
                    }];
                    break;
                }
            }
        }
        
        // 尝试2个厨师
        if (!bestAssignment && recipeCount <= 6) {
            outerLoop2:
            for (var i = 0; i < allCandidateChefIds.length; i++) {
                for (var j = i + 1; j < allCandidateChefIds.length; j++) {
                    var chef1 = chefToRecipes[allCandidateChefIds[i]];
                    var chef2 = chefToRecipes[allCandidateChefIds[j]];
                    
                    // 合并两个厨师能做的菜谱
                    var combined = chef1.recipeIndices.slice();
                    for (var k = 0; k < chef2.recipeIndices.length; k++) {
                        if (combined.indexOf(chef2.recipeIndices[k]) < 0) {
                            combined.push(chef2.recipeIndices[k]);
                        }
                    }
                    
                    // 检查是否覆盖所有菜谱，且每个厨师不超过3道
                    if (combined.length >= recipeCount) {
                        var covered = true;
                        for (var r = 0; r < recipeCount; r++) {
                            if (combined.indexOf(r) < 0) {
                                covered = false;
                                break;
                            }
                        }
                        if (covered) {
                            // 分配菜谱给两个厨师（优先分配给能做更多菜的厨师）
                            var assign1 = [], assign2 = [];
                            for (var r = 0; r < recipeCount; r++) {
                                var canChef1 = chef1.recipeIndices.indexOf(r) >= 0;
                                var canChef2 = chef2.recipeIndices.indexOf(r) >= 0;
                                if (canChef1 && !canChef2) {
                                    assign1.push(r);
                                } else if (!canChef1 && canChef2) {
                                    assign2.push(r);
                                } else {
                                    // 两个都能做，分配给菜谱少的
                                    if (assign1.length <= assign2.length && assign1.length < 3) {
                                        assign1.push(r);
                                    } else if (assign2.length < 3) {
                                        assign2.push(r);
                                    } else {
                                        assign1.push(r);
                                    }
                                }
                            }
                            
                            if (assign1.length <= 3 && assign2.length <= 3) {
                                bestAssignment = [];
                                if (assign1.length > 0) {
                                    bestAssignment.push({
                                        chefId: chef1.chefId,
                                        chef: chef1.chef,
                                        chefName: chef1.chefName,
                                        recipes: assign1.map(function(idx) { return recipeCandidates[idx].detail; })
                                    });
                                }
                                if (assign2.length > 0) {
                                    bestAssignment.push({
                                        chefId: chef2.chefId,
                                        chef: chef2.chef,
                                        chefName: chef2.chefName,
                                        recipes: assign2.map(function(idx) { return recipeCandidates[idx].detail; })
                                    });
                                }
                                break outerLoop2;
                            }
                        }
                    }
                }
            }
        }
        
        // 如果没找到1-2个厨师的解，使用贪心算法
        var assignment = [];
        var unassignedRecipes = noChefRecipes.slice(); // 初始化为没有候选厨师的菜谱
        
        if (bestAssignment) {
            assignment = bestAssignment;
        } else {
            // 贪心分配 - 按候选数量升序排序
            recipeCandidates.sort(function(a, b) {
                return a.candidates.length - b.candidates.length;
            });
            
            for (var i = 0; i < recipeCandidates.length; i++) {
                var rc = recipeCandidates[i];
                var assigned = false;
                
                // 尝试分配给已有的厨师
                for (var j = 0; j < assignment.length; j++) {
                    var existingChef = assignment[j];
                    if (existingChef.recipes.length >= 3) continue;
                    
                    // 检查该厨师是否在候选列表中
                    for (var k = 0; k < rc.candidates.length; k++) {
                        if (rc.candidates[k].chefId === existingChef.chefId) {
                            existingChef.recipes.push(rc.detail);
                            assigned = true;
                            break;
                        }
                    }
                    if (assigned) break;
                }
                
                // 如果没有分配成功，尝试添加新厨师
                if (!assigned) {
                    if (assignment.length >= 3) {
                        unassignedRecipes.push(rc.detail);
                        continue;
                    }
                    
                    // 选择能做最多剩余菜谱的厨师
                    var bestCandidate = null;
                    var maxCoverage = 0;
                    
                    for (var k = 0; k < rc.candidates.length; k++) {
                        var candidate = rc.candidates[k];
                        var coverage = 0;
                        // 计算这个厨师能覆盖多少剩余菜谱
                        for (var m = i; m < recipeCandidates.length; m++) {
                            for (var n = 0; n < recipeCandidates[m].candidates.length; n++) {
                                if (recipeCandidates[m].candidates[n].chefId === candidate.chefId) {
                                    coverage++;
                                    break;
                                }
                            }
                        }
                        if (coverage > maxCoverage) {
                            maxCoverage = coverage;
                            bestCandidate = candidate;
                        }
                    }
                    
                    if (!bestCandidate) {
                        bestCandidate = rc.candidates[0];
                    }
                    
                    assignment.push({
                        chefId: bestCandidate.chefId,
                        chef: bestCandidate.chef,
                        chefName: bestCandidate.chefName,
                        recipes: [rc.detail]
                    });
                }
            }
        }
        
        // 返回结果，包含是否完全覆盖的信息
        return {
            success: true,
            assignment: assignment,
            unassignedRecipes: unassignedRecipes,
            isPartial: unassignedRecipes.length > 0
        };
    }
    
    /**
     * 获取品级名称
     */
    function getRankName(rank) {
        var names = { 1: '可', 2: '优', 3: '特', 4: '神', 5: '传' };
        return names[rank] || '';
    }
    
    /**
     * 显示碰瓷查询结果 - 直接设置到厨师菜谱选择框
     * @param {Object} result - 查询结果对象
     */
    function displayPengciQueryResult(result) {
        var assignment = result.assignment;
        var unassignedRecipes = result.unassignedRecipes || [];
        var isPartial = result.isPartial || false;
        
        // 检查必要的函数是否存在
        if (typeof setCustomChef !== 'function' || typeof setCustomRecipe !== 'function') {
            console.error('setCustomChef 或 setCustomRecipe 函数不存在');
            if (typeof showAlert === 'function') {
                showAlert('设置失败：必要函数不存在');
            }
            return;
        }
        
        // 获取游戏数据
        var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
            ? calCustomRule.gameData 
            : (typeof CalCustomRule !== 'undefined' && CalCustomRule.gameData ? CalCustomRule.gameData : null);
        
        if (!gameData) {
            if (typeof showAlert === 'function') {
                showAlert('游戏数据未加载');
            }
            return;
        }
        
        // 先清空所有位置
        for (var i = 0; i < 3; i++) {
            setCustomChef(0, i, null);
            if (typeof setCustomEquip === 'function') {
                setCustomEquip(0, i, null);
            }
            for (var j = 0; j < 3; j++) {
                setCustomRecipe(0, i, j, null);
            }
        }
        
        // 设置查询结果
        for (var i = 0; i < assignment.length && i < 3; i++) {
            var item = assignment[i];
            
            // 设置厨师
            setCustomChef(0, i, item.chefId);
            
            // 设置菜谱
            for (var j = 0; j < item.recipes.length && j < 3; j++) {
                var recipeDetail = item.recipes[j];
                setCustomRecipe(0, i, j, recipeDetail.recipe.recipeId);
            }
        }
        
        // 刷新计算结果
        if (typeof calCustomResults === 'function') {
            calCustomResults(0);
        }
        
        // 显示提示
        var totalRecipes = 0;
        for (var i = 0; i < assignment.length; i++) {
            totalRecipes += assignment[i].recipes.length;
        }
        
        if (typeof showAlert === 'function') {
            if (isPartial) {
                // 部分成功，显示未能覆盖的菜谱
                var unassignedNames = [];
                for (var i = 0; i < unassignedRecipes.length; i++) {
                    unassignedNames.push('<span style="color:#337ab7">' + unassignedRecipes[i].recipeName + '</span>');
                }
                var totalQueryRecipes = totalRecipes + unassignedRecipes.length;
                showAlert('共查询 ' + totalQueryRecipes + ' 道菜谱，' + totalRecipes + ' 道达标，以下 ' + unassignedRecipes.length + ' 道菜谱无法同时覆盖：' + unassignedNames.join('、'));
            }
        }
    }
    
    /**
     * 计算贵客剩余可碰瓷次数
     * @param {string} guestName - 贵客名称
     * @param {Array} recipes - 菜谱数组
     * @returns {number} 剩余可碰瓷次数
     */
    function calculatePengciCount(guestName, recipes) {
        var count = 0;
        for (var i = 0; i < recipes.length; i++) {
            var recipe = recipes[i];
            // 只统计已拥有的菜谱（兼容布尔值和字符串"是"）
            var isGot = recipe.got === "是";
            if (!isGot) continue;
            // 检查菜谱的升阶贵客（优、特、神三个位置）
            if (recipe.guests && recipe.guests.length > 0) {
                for (var j = 0; j < Math.min(recipe.guests.length, 3); j++) {
                    if (recipe.guests[j].guest === guestName) {
                        // j=0对应优级(targetRank=2), j=1对应特级(targetRank=3), j=2对应神级(targetRank=4)
                        var targetRank = j + 2;
                        var currentRank = getPengciRankValue(recipe.rank);
                        // 如果当前等级小于目标等级，说明还可以碰瓷
                        if (currentRank < targetRank) {
                            count++;
                        }
                    }
                }
            }
        }
        return count;
    }
    
    /**
     * 获取等级数值（碰瓷查询专用）
     * @param {string} rank - 等级字符串（可、优、特、神、传）
     * @returns {number} 等级数值
     */
    function getPengciRankValue(rank) {
        switch(rank) {
            case '可': return 1;
            case '优': return 2;
            case '特': return 3;
            case '神': return 4;
            case '传': return 5;
            default: return 0;
        }
    }
    
    /**
     * 获取主线任务贵客集合
     * @param {Array} quests - 任务数组
     * @returns {Set} 主线任务贵客名称集合
     */
    function getMainlineGuests(quests) {
        var mainlineGuests = new Set();
        if (!quests) return mainlineGuests;
        
        for (var i = 0; i < quests.length; i++) {
            var quest = quests[i];
            if (quest.type === '主线任务' && quest.conditions) {
                for (var j = 0; j < quest.conditions.length; j++) {
                    var condition = quest.conditions[j];
                    if (condition.guest && condition.guest.length > 0) {
                        mainlineGuests.add(condition.guest);
                    }
                }
            }
        }
        return mainlineGuests;
    }
    
    /**
     * 获取主线任务贵客映射（questId -> 贵客名称集合）
     * @param {Array} quests - 任务数组
     * @returns {Object} questId到贵客名称集合的映射
     */
    function getMainlineQuestGuestsMap(quests) {
        var questGuestsMap = {};
        if (!quests) return questGuestsMap;
        
        for (var i = 0; i < quests.length; i++) {
            var quest = quests[i];
            if (quest.type === '主线任务' && quest.conditions) {
                var guestNames = [];
                for (var j = 0; j < quest.conditions.length; j++) {
                    var condition = quest.conditions[j];
                    if (condition.guest && condition.guest.length > 0) {
                        guestNames.push(condition.guest);
                    }
                }
                if (guestNames.length > 0) {
                    questGuestsMap[quest.questId] = guestNames;
                }
            }
        }
        return questGuestsMap;
    }
    
    /**
     * 根据任务进度获取未完成的主线任务贵客（>= 任务进度的贵客）
     * @param {Object} questGuestsMap - questId到贵客名称的映射
     * @param {number} progressId - 当前任务进度ID
     * @returns {Set} 未完成的主线任务贵客名称集合
     */
    function getUncompletedMainlineGuests(questGuestsMap, progressId) {
        var guestNames = new Set();
        for (var questId in questGuestsMap) {
            if (parseInt(questId) >= progressId) {
                var guests = questGuestsMap[questId];
                for (var i = 0; i < guests.length; i++) {
                    guestNames.add(guests[i]);
                }
            }
        }
        return guestNames;
    }
    
    /**
     * 根据任务进度获取已完成的主线任务贵客（< 任务进度的贵客）
     * @param {Object} questGuestsMap - questId到贵客名称的映射
     * @param {number} progressId - 当前任务进度ID
     * @returns {Set} 已完成的主线任务贵客名称集合
     */
    function getCompletedMainlineGuests(questGuestsMap, progressId) {
        var guestNames = new Set();
        if (progressId <= 0) return guestNames;
        
        for (var questId in questGuestsMap) {
            if (parseInt(questId) < progressId) {
                var guests = questGuestsMap[questId];
                for (var i = 0; i < guests.length; i++) {
                    guestNames.add(guests[i]);
                }
            }
        }
        return guestNames;
    }
    
    /**
     * 根据任务编号获取对应的贵客名称列表
     * @param {Array} quests - 任务数组
     * @param {number} questId - 任务编号
     * @returns {Array} 贵客名称列表
     */
    function getGuestsByQuestId(quests, questId) {
        var guestNames = [];
        if (!quests || !questId) return guestNames;
        
        for (var i = 0; i < quests.length; i++) {
            var quest = quests[i];
            if (quest.questId === questId && quest.type === '主线任务' && quest.conditions) {
                for (var j = 0; j < quest.conditions.length; j++) {
                    var condition = quest.conditions[j];
                    if (condition.guest && condition.guest.length > 0) {
                        guestNames.push(condition.guest);
                    }
                }
                break;
            }
        }
        return guestNames;
    }
    
    /**
     * 获取贵客首次出现的任务ID
     * @param {string} guestName - 贵客名称
     * @param {Object} questGuestsMap - questId到贵客名称的映射
     * @returns {number|null} 首次出现的任务ID
     */
    function getGuestFirstQuestId(guestName, questGuestsMap) {
        var questIds = Object.keys(questGuestsMap).map(function(id) { return parseInt(id); }).sort(function(a, b) { return a - b; });
        for (var i = 0; i < questIds.length; i++) {
            var questId = questIds[i];
            var guests = questGuestsMap[questId];
            if (guests && guests.indexOf(guestName) >= 0) {
                return questId;
            }
        }
        return null;
    }
    
    /**
     * 初始化碰瓷贵客选择框（使用自定义下拉菜单实现展开式贵客列表）
     */
    function initPengciGuestSelect() {
        var $wrapper = $("#pengci-guest-dropdown-wrapper");
        var $btn = $("#pengci-guest-dropdown-btn");
        var $menu = $("#pengci-guest-dropdown-menu");
        var $container = $("#pengci-guest-select-container");
        var $queryArea = $("#pengci-query-area");
        
        if (!$wrapper.length || !$btn.length || !$menu.length || !$container.length) {
            return;
        }
        
        // 构建下拉菜单内容
        buildPengciGuestDropdown($container);
        
        // 计算下拉菜单最大高度的函数（参考 Bootstrap-select 的 setMenuSize 逻辑）
        function calculateMenuHeight() {
            var $list = $container.find('.pengci-guest-list');
            var $searchWrapper = $container.find('.pengci-search-wrapper');
            var $tabs = $container.find('.pengci-guest-category-tabs');
            
            // 获取按钮位置信息（参考 Bootstrap-select 的 getSelectPosition）
            var btnOffset = $btn.offset();
            var btnHeight = $btn.outerHeight();
            var windowHeight = $(window).height();
            var scrollTop = $(window).scrollTop();
            
            // 计算按钮底部到窗口底部的距离（参考 Bootstrap-select 的 selectOffsetBot）
            // selectOffsetBot = windowHeight - (btnOffset.top - scrollTop) - btnHeight - padding
            var selectOffsetTop = btnOffset.top - scrollTop;
            var selectOffsetBot = windowHeight - selectOffsetTop - btnHeight;
            
            // 菜单的额外高度（边框、padding等）
            var menuPaddingVert = 0;
            var menuBorderVert = 2; // 上下边框各1px
            
            // 搜索框和标签的高度
            var headerHeight = 0;
            if ($searchWrapper.length && $searchWrapper.is(':visible')) {
                headerHeight += $searchWrapper.outerHeight(true);
            }
            if ($tabs.length && $tabs.is(':visible')) {
                headerHeight += $tabs.outerHeight(true);
            }
            
            // 菜单额外高度 = padding + border + header
            var menuExtrasVert = menuPaddingVert + menuBorderVert + headerHeight;
            
            // 可用高度 = 按钮下方空间 - 菜单额外高度 - 底部边距(10px)
            var availableHeight = selectOffsetBot - menuExtrasVert - 10;
            
            // 最小高度保证至少能显示3个贵客项（每项约40px）
            var minHeight = 120;
            
            // 列表可用高度
            var listMaxHeight = Math.max(minHeight, availableHeight);
            
            // 设置列表最大高度
            $list.css('max-height', listMaxHeight + 'px');
            
            // 同时设置菜单的最大高度（列表高度 + 头部高度 + 边框）
            var menuMaxHeight = listMaxHeight + headerHeight + menuBorderVert;
            $menu.css('max-height', menuMaxHeight + 'px');
        }
        
        // 点击按钮切换下拉菜单
        $btn.off("click").on("click", function(e) {
            e.stopPropagation();
            if ($menu.is(":visible")) {
                // 收起
                $menu.hide();
                $wrapper.removeClass("open");
                $queryArea.css("z-index", "");
            } else {
                // 关闭其他 Bootstrap-select 选择框
                $('.bootstrap-select').removeClass('open');
                $('.bootstrap-select .dropdown-menu').css('display', '');
                $('.bootstrap-select .dropdown-toggle').blur();
                // 移除编辑状态
                $('.selected-box').removeClass('editing');
                
                // 关闭符文碰瓷选择框
                $(".pengci-rune-dropdown-wrapper").removeClass("open");
                $("#pengci-rune-select-container").css('display', '');
                
                // 展开时：先设置 z-index 和添加 open 类（确保窄屏幕下 position:fixed 生效）
                $queryArea.css("z-index", "200");
                $wrapper.addClass("open");
                
                // 使用 visibility:hidden 来计算高度，避免闪烁
                $menu.css({
                    'visibility': 'hidden',
                    'display': 'block'
                });
                calculateMenuHeight();
                $menu.css('visibility', '');
            }
        });
        
        // 窗口大小变化或滚动时重新计算高度（参考 Bootstrap-select）
        $(window).off("resize.pengciDropdown scroll.pengciDropdown").on("resize.pengciDropdown scroll.pengciDropdown", function() {
            if ($menu.is(":visible")) {
                calculateMenuHeight();
            }
        });
        
        // 点击下拉菜单内部不关闭
        $menu.off("click").on("click", function(e) {
            e.stopPropagation();
        });
        
        // 点击外部关闭下拉菜单
        $(document).off("click.pengciDropdown").on("click.pengciDropdown", function(e) {
            if (!$(e.target).closest("#pengci-guest-dropdown-wrapper").length) {
                if ($menu.is(":visible")) {
                    $menu.hide();
                    $wrapper.removeClass("open");
                    $queryArea.css("z-index", "");
                }
            }
        });
        
        // 监听其他 Bootstrap-select 选择框打开时，关闭贵客下拉框
        $(document).off("show.bs.select.pengciDropdown").on("show.bs.select.pengciDropdown", function(e) {
            if ($menu.is(":visible")) {
                $menu.hide();
                $wrapper.removeClass("open");
                $queryArea.css("z-index", "");
            }
        });
        
        // 从本地存储恢复主线任务进度
        var savedMainlineProgress = localStorage.getItem('pengci_mainline_progress');
        if (savedMainlineProgress) {
            $("#input-pengci-mainline").val(savedMainlineProgress);
        }
        
        // 监听主线任务输入框变化，保存到本地存储并重新构建下拉菜单
        $("#input-pengci-mainline").off("input.pengciDropdown").on("input.pengciDropdown", function() {
            var value = $(this).val();
            if (value) {
                localStorage.setItem('pengci_mainline_progress', value);
            } else {
                localStorage.removeItem('pengci_mainline_progress');
            }
            buildPengciGuestDropdown($container);
        });
        
        // 查询厨师配置按钮点击事件
        $("#btn-pengci-guest-query").off("click").on("click", function() {
            if (selectedPengciRecipes.length === 0) {
                if (typeof showAlert === 'function') {
                    showAlert('请先选择要碰瓷的菜谱');
                } else {
                    alert('请先选择要碰瓷的菜谱');
                }
                return;
            }
            
            // 执行查询
            var result = queryPengciChefConfig();
            
            if (!result.success) {
                if (typeof showAlert === 'function') {
                    showAlert(result.message);
                } else {
                    alert(result.message);
                }
                return;
            }
            
            // 显示查询结果
            displayPengciQueryResult(result);
        });
    }
    
    /**
     * 构建碰瓷贵客自定义下拉菜单
     * @param {jQuery} $container - 容器元素
     */
    function buildPengciGuestDropdown($container) {
        // 获取游戏数据
        var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
                       ? calCustomRule.gameData : null;
        
        if (!gameData || !gameData.guests) {
            $container.html('<div class="pengci-dropdown-empty">游戏数据未加载</div>');
            return;
        }
        
        var guests = gameData.guests;
        var recipes = gameData.recipes || [];
        var quests = gameData.quests || [];
        
        // 获取主线任务进度
        var mainlineProgressId = parseInt($("#input-pengci-mainline").val()) || 0;
        
        // 获取主线任务贵客映射
        var questGuestsMap = getMainlineQuestGuestsMap(quests);
        
        // 获取未完成的主线任务贵客（>= 任务进度）
        var uncompletedMainlineGuests = getUncompletedMainlineGuests(questGuestsMap, mainlineProgressId);
        
        // 获取已完成的主线任务贵客（< 任务进度）
        var completedMainlineGuests = getCompletedMainlineGuests(questGuestsMap, mainlineProgressId);
        
        // 获取所有主线任务贵客
        var allMainlineGuests = getMainlineGuests(quests);
        
        // 计算每个贵客的碰瓷次数并分类
        var guestList = [];
        for (var i = 0; i < guests.length; i++) {
            var guest = guests[i];
            var pengciCount = calculatePengciCount(guest.name, recipes);
            
            // 判断是否为主线贵客（未完成的主线任务贵客）
            var isMainline = uncompletedMainlineGuests.has(guest.name);
            
            // 判断是否为普通贵客（不在未完成主线任务中 或 已完成的主线任务贵客）
            var isNormal = !uncompletedMainlineGuests.has(guest.name) || completedMainlineGuests.has(guest.name);
            
            // 添加所有贵客（包括无法碰瓷的）
            guestList.push({
                name: guest.name,
                pengciCount: pengciCount,
                isMainline: isMainline,
                isNormal: isNormal,
                // 记录贵客首次出现的任务ID（用于主线贵客排序）
                firstQuestId: getGuestFirstQuestId(guest.name, questGuestsMap)
            });
        }
        
        // 按碰瓷次数降序排序，有碰瓷次数的在前，无碰瓷次数的在后
        guestList.sort(function(a, b) {
            // 有碰瓷次数的优先
            if (a.pengciCount > 0 && b.pengciCount === 0) return -1;
            if (a.pengciCount === 0 && b.pengciCount > 0) return 1;
            // 都有碰瓷次数，按次数降序
            if (a.pengciCount !== b.pengciCount) return b.pengciCount - a.pengciCount;
            // 次数相同，按名称排序
            return a.name.localeCompare(b.name);
        });
        
        // 构建HTML
        var html = '';
        
        // 搜索框
        html += '<div class="pengci-search-wrapper">';
        html += '<input type="text" class="form-control pengci-search-input" placeholder="贵客名称或任务编号">';
        html += '</div>';
        
        // 已选菜谱展示区域
        html += '<div class="pengci-selected-recipes-display"></div>';
        
        // 清空选择按钮
        html += '<div class="pengci-clear-wrapper">';
        html += '<button type="button" class="btn btn-default btn-sm btn-pengci-clear">清空选择</button>';
        html += '</div>';
        
        // 分类标签
        html += '<ul class="nav nav-tabs pengci-guest-category-tabs">';
        html += '<li class="' + (pengciGuestCategory === 'normal' ? 'active' : '') + '"><a href="#" data-category="normal">普通碰瓷</a></li>';
        html += '<li class="' + (pengciGuestCategory === 'mainline' ? 'active' : '') + '"><a href="#" data-category="mainline">主线碰瓷</a></li>';
        html += '</ul>';
        
        // 贵客列表
        html += '<div class="pengci-guest-list">';
        for (var i = 0; i < guestList.length; i++) {
            var guest = guestList[i];
            var countText = guest.pengciCount > 0 ? '还可碰瓷 ' + guest.pengciCount + ' 次' : '无可碰瓷菜谱';
            var countClass = guest.pengciCount > 0 ? 'pengci-count' : 'pengci-count no-pengci';
            
            html += '<div class="pengci-guest-section" data-guest="' + guest.name + '" data-is-mainline="' + (guest.isMainline ? '1' : '0') + '" data-is-normal="' + (guest.isNormal ? '1' : '0') + '" data-first-quest-id="' + (guest.firstQuestId || 9999) + '" data-pengci-count="' + guest.pengciCount + '">';
            html += '<div class="pengci-guest-header">';
            html += '<span class="guest-name">' + guest.name + '</span>';
            html += '<span class="' + countClass + '">' + countText + '</span>';
            html += '<span class="expand-arrow glyphicon glyphicon-chevron-right"></span>';
            html += '</div>';
            html += '<div class="pengci-guest-recipes" style="display: none;"></div>';
            html += '</div>';
        }
        html += '</div>';
        
        $container.html(html);
        
        // 绑定事件
        bindPengciDropdownEvents($container, recipes);
    }
    
    /**
     * 绑定碰瓷下拉菜单事件
     * @param {jQuery} $container - 容器元素
     * @param {Array} recipes - 菜谱数组
     */
    function bindPengciDropdownEvents($container, recipes) {
        // 分类标签点击事件
        $container.find('.pengci-guest-category-tabs a').off('click').on('click', function(e) {
            e.preventDefault();
            var $tab = $(this);
            var category = $tab.attr('data-category');
            
            // 更新标签状态
            $tab.parent().addClass('active').siblings().removeClass('active');
            pengciGuestCategory = category;
            
            // 过滤贵客列表
            filterPengciGuestSections($container, category);
        });
        
        // 搜索框输入事件
        $container.find('.pengci-search-input').off('input').on('input', function() {
            var keyword = $(this).val().toLowerCase();
            filterPengciGuestByKeyword($container, keyword);
        });
        
        // 贵客标题点击事件（展开/收起菜谱列表）
        $container.find('.pengci-guest-header').off('click').on('click', function() {
            var $header = $(this);
            var $section = $header.closest('.pengci-guest-section');
            var $recipesContainer = $section.find('.pengci-guest-recipes');
            var $arrow = $header.find('.expand-arrow');
            var guestName = $section.attr('data-guest');
            
            // 切换展开状态
            if ($recipesContainer.is(':visible')) {
                // 收起
                $recipesContainer.slideUp(200);
                $arrow.removeClass('glyphicon-chevron-down').addClass('glyphicon-chevron-right');
                $section.removeClass('expanded');
            } else {
                // 展开 - 先加载菜谱内容
                var recipesHtml = generatePengciRecipesHtml(guestName, recipes);
                $recipesContainer.html(recipesHtml);
                
                // 绑定菜谱点击事件
                $recipesContainer.find('.pengci-recipe-inline').off('click').on('click', function(e) {
                    e.stopPropagation();
                    var $recipe = $(this);
                    var recipeName = $recipe.attr('data-recipe-name');
                    
                    // 从recipes数组中查找菜谱对象
                    var recipeObj = null;
                    for (var i = 0; i < recipes.length; i++) {
                        if (recipes[i].name === recipeName) {
                            recipeObj = recipes[i];
                            break;
                        }
                    }
                    
                    if (recipeObj && togglePengciRecipeSelection(recipeName, guestName, recipeObj)) {
                        // 更新UI - 切换选中状态
                        var isSelected = findSelectedRecipe(recipeName) !== null && findSelectedRecipe(recipeName).guest === guestName;
                        $recipe.toggleClass('selected', isSelected);
                    }
                });
                
                $recipesContainer.slideDown(200);
                $arrow.removeClass('glyphicon-chevron-right').addClass('glyphicon-chevron-down');
                $section.addClass('expanded');
            }
        });
        
        // 清空选择按钮点击事件
        $container.find('.btn-pengci-clear').off('click').on('click', function(e) {
            e.stopPropagation();
            selectedPengciRecipes = [];
            updatePengciDropdownText();
            // 清除所有菜谱的选中状态
            $container.find('.pengci-recipe-inline.selected').removeClass('selected');
        });
        
        // 应用当前分类过滤
        filterPengciGuestSections($container, pengciGuestCategory);
        
        // 初始化已选菜谱展示区域
        updateSelectedRecipesDisplay();
    }
    
    /**
     * 生成贵客碰瓷菜谱HTML（用于下拉菜单内展开）
     * @param {string} guestName - 贵客名称
     * @param {Array} recipes - 菜谱数组
     * @returns {string} HTML字符串
     */
    function generatePengciRecipesHtml(guestName, recipes) {
        var rankLabels = ['优', '特', '神'];
        var matchedRecipes = [];
        
        // 筛选包含该贵客的已拥有菜谱，且有未完成的碰瓷
        for (var i = 0; i < recipes.length; i++) {
            var recipe = recipes[i];
            var isGot = recipe.got === "是";
            if (!isGot) continue;
            
            if (recipe.guests && recipe.guests.length > 0) {
                var hasGuest = false;
                var hasUnfinished = false;
                for (var j = 0; j < Math.min(recipe.guests.length, 3); j++) {
                    if (recipe.guests[j].guest === guestName) {
                        hasGuest = true;
                        var targetRank = j + 2;
                        var currentRank = getPengciRankValue(recipe.rank);
                        if (currentRank < targetRank) {
                            hasUnfinished = true;
                        }
                    }
                }
                if (hasGuest && hasUnfinished) {
                    matchedRecipes.push(recipe);
                }
            }
        }
        
        if (matchedRecipes.length === 0) {
            return '<div class="pengci-recipe-empty-inline">没有可碰瓷的菜谱</div>';
        }
        
        var html = '';
        for (var i = 0; i < matchedRecipes.length; i++) {
            var recipe = matchedRecipes[i];
            var currentRank = getPengciRankValue(recipe.rank);
            
            // 生成星级显示
            var stars = '';
            for (var s = 0; s < recipe.rarity; s++) {
                stars += '★';
            }
            
            // 生成技法值显示
            var skillsHtml = '';
            var skillNames = { stirfry: '炒', boil: '煮', knife: '切', fry: '炸', bake: '烤', steam: '蒸' };
            var skillTypes = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
            var skillParts = [];
            for (var sk = 0; sk < skillTypes.length; sk++) {
                var skillType = skillTypes[sk];
                var skillVal = recipe[skillType] || 0;
                if (skillVal > 0) {
                    skillParts.push(skillNames[skillType] + skillVal);
                }
            }
            if (skillParts.length > 0) {
                skillsHtml = '<span class="recipe-skills">' + skillParts.join(' ') + '</span>';
            }
            
            // 生成升阶贵客列表
            var guestsHtml = '';
            for (var j = 0; j < Math.min(recipe.guests.length, 3); j++) {
                var recipeGuest = recipe.guests[j];
                var rankLabel = rankLabels[j];
                var targetRank = j + 2;
                var isCompleted = currentRank >= targetRank;
                var isCurrentGuest = recipeGuest.guest === guestName;
                
                var guestClass = 'pengci-inline-guest';
                if (isCompleted) {
                    guestClass += ' completed';
                } else if (isCurrentGuest) {
                    guestClass += ' current';
                }
                
                guestsHtml += '<span class="' + guestClass + '">' + rankLabel + '-' + recipeGuest.guest + '</span>';
            }
            
            // 检查是否已选中（需要检查菜谱名和贵客名）
            var existingRecord = findSelectedRecipe(recipe.name);
            var isSelected = existingRecord !== null && existingRecord.guest === guestName;
            var selectedClass = isSelected ? ' selected' : '';
            
            html += '<div class="pengci-recipe-inline' + selectedClass + '" data-recipe-name="' + recipe.name + '">';
            html += '<div class="recipe-info">';
            html += '<span class="recipe-name">' + recipe.name + '<span class="check-mark">✓</span></span>';
            html += '<span class="recipe-stars">' + stars + '</span>';
            html += skillsHtml;
            html += '</div>';
            html += '<div class="recipe-guests">' + guestsHtml + '</div>';
            html += '</div>';
        }
        
        return html;
    }
    
    /**
     * 更新选择框显示文字
     */
    function updatePengciDropdownText() {
        var $text = $('#pengci-guest-dropdown-btn .pengci-dropdown-text');
        if (selectedPengciRecipes.length === 0) {
            $text.text('选择碰瓷菜谱').removeClass('has-selection');
        } else if (selectedPengciRecipes.length === 1) {
            $text.text(selectedPengciRecipes[0].recipe).addClass('has-selection');
        } else {
            $text.text('已选择' + selectedPengciRecipes.length + '道菜').addClass('has-selection');
        }
        
        // 更新已选菜谱展示区域
        updateSelectedRecipesDisplay();
    }
    
    /**
     * 更新已选菜谱展示区域
     */
    function updateSelectedRecipesDisplay() {
        var $display = $('.pengci-selected-recipes-display');
        if (!$display.length) return;
        
        if (selectedPengciRecipes.length === 0) {
            $display.empty().hide();
            return;
        }
        
        var html = '';
        for (var i = 0; i < selectedPengciRecipes.length; i++) {
            var item = selectedPengciRecipes[i];
            html += '<span class="pengci-selected-tag" data-recipe="' + item.recipe + '">';
            html += '<span class="tag-name">' + item.recipe + '</span>';
            html += '<span class="tag-remove">×</span>';
            html += '</span>';
        }
        
        $display.html(html).show();
        
        // 绑定移除按钮点击事件
        $display.find('.tag-remove').off('click').on('click', function(e) {
            e.stopPropagation();
            var $tag = $(this).closest('.pengci-selected-tag');
            var recipeName = $tag.attr('data-recipe');
            
            // 从选中列表中移除
            for (var i = 0; i < selectedPengciRecipes.length; i++) {
                if (selectedPengciRecipes[i].recipe === recipeName) {
                    selectedPengciRecipes.splice(i, 1);
                    break;
                }
            }
            
            // 更新显示
            updatePengciDropdownText();
            
            // 更新菜谱列表中的勾选状态
            $('.pengci-recipe-inline[data-recipe-name="' + recipeName + '"]').removeClass('selected');
        });
    }
    
    /**
     * 切换菜谱选中状态
     * @param {string} recipeName - 菜谱名称
     * @param {string} guestName - 贵客名称
     * @param {Object} recipe - 菜谱对象
     * @returns {boolean} 是否成功切换
     */
    function togglePengciRecipeSelection(recipeName, guestName, recipe) {
        // 查找是否已选中该菜谱
        var existingRecord = findSelectedRecipe(recipeName);
        
        if (existingRecord) {
            // 已选中
            if (existingRecord.guest === guestName) {
                // 同一贵客下，取消选择
                var index = selectedPengciRecipes.indexOf(existingRecord);
                selectedPengciRecipes.splice(index, 1);
                updatePengciDropdownText();
                return true;
            } else {
                // 不同贵客下，提示无法选择
                var msg = '该菜谱已在<span style="color:#337ab7;font-weight:bold;">' + existingRecord.guest + '</span>贵客中勾选，无法同时碰瓷';
                if (typeof showAlert === 'function') {
                    showAlert(msg);
                } else {
                    alert('该菜谱已在' + existingRecord.guest + '贵客中勾选，无法同时碰瓷');
                }
                return false;
            }
        } else {
            // 未选中，添加选择
            if (selectedPengciRecipes.length >= MAX_PENGCI_RECIPES) {
                if (typeof showAlert === 'function') {
                    showAlert('最多只能选择' + MAX_PENGCI_RECIPES + '道菜谱');
                } else {
                    alert('最多只能选择' + MAX_PENGCI_RECIPES + '道菜谱');
                }
                return false;
            }
            
            // 获取最低可碰瓷品级
            var lowestRank = getLowestPengciRank(guestName, recipe);
            if (lowestRank === null) {
                if (typeof showAlert === 'function') {
                    showAlert('该菜谱在' + guestName + '贵客下没有可碰瓷的品级');
                } else {
                    alert('该菜谱在' + guestName + '贵客下没有可碰瓷的品级');
                }
                return false;
            }
            
            // 添加到选中列表
            selectedPengciRecipes.push({
                guest: guestName,
                recipe: recipeName,
                rank: lowestRank
            });
            updatePengciDropdownText();
            return true;
        }
    }
    
    /**
     * 按分类过滤贵客区块
     * @param {jQuery} $container - 容器元素
     * @param {string} category - 分类（normal/mainline）
     */
    function filterPengciGuestSections($container, category) {
        var $sections = $container.find('.pengci-guest-section');
        
        // 先过滤显示
        $sections.each(function() {
            var $section = $(this);
            var isMainline = $section.attr('data-is-mainline') === '1';
            var isNormal = $section.attr('data-is-normal') === '1';
            
            if (category === 'normal') {
                // 普通碰瓷：显示普通贵客
                $section.toggle(isNormal);
            } else if (category === 'mainline') {
                // 主线碰瓷：显示主线贵客
                $section.toggle(isMainline);
            } else {
                $section.show();
            }
        });
        
        // 主线碰瓷模式下，按任务ID排序
        if (category === 'mainline') {
            var $list = $container.find('.pengci-guest-list');
            var $visibleSections = $list.find('.pengci-guest-section:visible').detach();
            
            // 按 firstQuestId 排序
            $visibleSections.sort(function(a, b) {
                var questIdA = parseInt($(a).attr('data-first-quest-id')) || 9999;
                var questIdB = parseInt($(b).attr('data-first-quest-id')) || 9999;
                return questIdA - questIdB;
            });
            
            // 重新添加到列表
            $list.append($visibleSections);
            // 同时把隐藏的也加回去
            $list.append($container.find('.pengci-guest-section:hidden'));
        }
    }
    
    /**
     * 按关键词过滤贵客
     * @param {jQuery} $container - 容器元素
     * @param {string} keyword - 搜索关键词
     */
    function filterPengciGuestByKeyword($container, keyword) {
        // 获取游戏数据用于任务编号搜索
        var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
                       ? calCustomRule.gameData : null;
        var quests = gameData ? gameData.quests : [];
        
        // 检查是否输入的是任务编号
        var questId = parseInt(keyword);
        var questGuestNames = [];
        if (!isNaN(questId) && questId > 0) {
            questGuestNames = getGuestsByQuestId(quests, questId);
        }
        
        $container.find('.pengci-guest-section').each(function() {
            var $section = $(this);
            var guestName = $section.attr('data-guest');
            var guestNameLower = guestName.toLowerCase();
            var isMainline = $section.attr('data-is-mainline') === '1';
            var isNormal = $section.attr('data-is-normal') === '1';
            
            // 分类过滤
            var matchCategory = (pengciGuestCategory === 'normal' && isNormal) ||
                               (pengciGuestCategory === 'mainline' && isMainline) ||
                               (pengciGuestCategory === 'all');
            
            // 关键词过滤：支持贵客名称或任务编号
            var matchKeyword = true;
            if (keyword) {
                if (questGuestNames.length > 0) {
                    // 如果是任务编号，按任务中的贵客过滤
                    matchKeyword = questGuestNames.indexOf(guestName) >= 0;
                } else {
                    // 否则按贵客名称搜索
                    matchKeyword = guestNameLower.indexOf(keyword.toLowerCase()) >= 0;
                }
            }
            
            $section.toggle(matchCategory && matchKeyword);
        });
    }
    
    /**
     * 显示选中贵客的碰瓷菜谱列表（外部容器版本，保留兼容）
     * @param {string} guestName - 贵客名称
     */
    function showPengciGuestRecipes(guestName) {
        var $container = $("#pengci-guest-recipe-list");
        if (!$container.length) {
            return;
        }
        
        // 获取游戏数据
        var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
                       ? calCustomRule.gameData : null;
        
        if (!gameData || !gameData.recipes) {
            $container.html('<div class="pengci-recipe-empty">游戏数据未加载</div>');
            return;
        }
        
        var recipes = gameData.recipes;
        var html = generatePengciRecipesHtml(guestName, recipes);
        
        if (html.indexOf('pengci-recipe-empty-inline') >= 0) {
            $container.html('<div class="pengci-recipe-empty">该贵客没有可碰瓷的菜谱</div>');
        } else {
            // 转换为外部容器样式
            $container.html('<div class="pengci-recipe-list-content">' + html + '</div>');
        }
    }
    
    /**
     * 填充碰瓷贵客选项（重新构建下拉菜单）
     */
    function populatePengciGuestOptions() {
        var $container = $("#pengci-guest-select-container");
        if ($container.length) {
            buildPengciGuestDropdown($container);
        } else {
            // 如果容器不存在，调用初始化函数
            initPengciGuestSelect();
        }
    }
    
    /**
     * 过滤碰瓷贵客选项（兼容旧接口）
     * @param {string} category - 分类（normal/mainline）
     */
    function filterPengciGuestOptions(category) {
        var $container = $("#pengci-guest-select-container");
        if ($container.length) {
            filterPengciGuestSections($container, category);
        }
    }
    
    // ========================================
    // 符文碰瓷下拉框相关函数
    // ========================================
    
    // 符文碰瓷选中的菜谱缓存
    var selectedRuneRecipes = [];
    var MAX_RUNE_RECIPES = 9;
    var runeCategory = 'gold'; // 默认金符文
    
    // 符文分类
    var GOLD_RUNES = ['恐怖利刃', '鼓风机', '蒸馏杯', '千年煮鳖', '香烤鱼排', '五星炒果'];
    var SILVER_RUNES = ['刀嘴鹦鹉', '一昧真火', '蒸汽宝石', '耐煮的水草', '焦虫', '暖石'];
    var BRONZE_RUNES = ['剪刀蟹', '油火虫', '蒸汽耳环', '防水的柠檬', '烤焦的菊花', '五香果'];
    
    /**
     * 初始化符文碰瓷选择框
     */
    function initPengciRuneSelect() {
        var $wrapper = $(".pengci-rune-dropdown-wrapper");
        var $btn = $("#pengci-rune-dropdown-btn");
        var $container = $("#pengci-rune-select-container");
        var $queryArea = $wrapper.closest(".pengci-query-area");
        
        if (!$wrapper.length || !$btn.length || !$container.length) {
            return;
        }
        
        // 构建下拉菜单内容
        buildPengciRuneDropdown($container);
        
        // 计算下拉菜单最大高度的函数（参考贵客碰瓷的实现）
        function calculateMenuHeight() {
            var $list = $container.find('.pengci-rune-list');
            var $searchWrapper = $container.find('.pengci-search-wrapper');
            var $tabs = $container.find('.pengci-rune-category-tabs');
            var $selectedDisplay = $container.find('.pengci-rune-selected-display');
            var $clearWrapper = $container.find('.pengci-clear-wrapper');
            
            // 获取按钮位置信息
            var btnOffset = $btn.offset();
            var btnHeight = $btn.outerHeight();
            var windowHeight = $(window).height();
            var scrollTop = $(window).scrollTop();
            
            // 计算按钮底部到窗口底部的距离
            var selectOffsetTop = btnOffset.top - scrollTop;
            var selectOffsetBot = windowHeight - selectOffsetTop - btnHeight;
            
            // 菜单的额外高度（边框、padding等）
            var menuPaddingVert = 0;
            var menuBorderVert = 2;
            
            // 头部元素的高度
            var headerHeight = 0;
            if ($searchWrapper.length && $searchWrapper.is(':visible')) {
                headerHeight += $searchWrapper.outerHeight(true);
            }
            if ($selectedDisplay.length && $selectedDisplay.is(':visible')) {
                headerHeight += $selectedDisplay.outerHeight(true);
            }
            if ($clearWrapper.length && $clearWrapper.is(':visible')) {
                headerHeight += $clearWrapper.outerHeight(true);
            }
            if ($tabs.length && $tabs.is(':visible')) {
                headerHeight += $tabs.outerHeight(true);
            }
            
            // 菜单额外高度
            var menuExtrasVert = menuPaddingVert + menuBorderVert + headerHeight;
            
            // 可用高度
            var availableHeight = selectOffsetBot - menuExtrasVert - 10;
            
            // 最小高度
            var minHeight = 120;
            
            // 列表可用高度
            var listMaxHeight = Math.max(minHeight, availableHeight);
            
            // 设置列表最大高度
            $list.css('max-height', listMaxHeight + 'px');
            
            // 设置菜单的最大高度
            var menuMaxHeight = listMaxHeight + headerHeight + menuBorderVert;
            $container.css('max-height', menuMaxHeight + 'px');
        }
        
        // 点击按钮切换下拉菜单
        $btn.off("click").on("click", function(e) {
            e.stopPropagation();
            if ($wrapper.hasClass("open")) {
                // 收起
                $wrapper.removeClass("open");
                $container.css('display', ''); // 清除手动设置的display，让CSS控制
                $queryArea.css("z-index", "");
            } else {
                // 关闭其他 Bootstrap-select 选择框
                $('.bootstrap-select').removeClass('open');
                $('.bootstrap-select .dropdown-menu').css('display', '');
                $('.bootstrap-select .dropdown-toggle').blur();
                // 移除编辑状态
                $('.selected-box').removeClass('editing');
                
                // 关闭贵客碰瓷选择框
                $("#pengci-guest-dropdown-wrapper").removeClass("open");
                $("#pengci-guest-dropdown-menu").hide();
                
                // 展开时：先设置 z-index 和添加 open 类
                $queryArea.css("z-index", "200");
                $wrapper.addClass("open");
                
                // 使用 visibility:hidden 来计算高度，避免闪烁
                $container.css({
                    'visibility': 'hidden',
                    'display': 'block'
                });
                calculateMenuHeight();
                $container.css('visibility', '');
            }
        });
        
        // 窗口大小变化或滚动时重新计算高度
        $(window).off("resize.pengciRuneDropdown scroll.pengciRuneDropdown").on("resize.pengciRuneDropdown scroll.pengciRuneDropdown", function() {
            if ($wrapper.hasClass("open")) {
                calculateMenuHeight();
            }
        });
        
        // 点击下拉菜单内部不关闭
        $container.off("click").on("click", function(e) {
            e.stopPropagation();
        });
        
        // 点击外部关闭下拉菜单
        $(document).off("click.pengciRuneDropdown").on("click.pengciRuneDropdown", function(e) {
            if (!$(e.target).closest(".pengci-rune-dropdown-wrapper").length) {
                if ($wrapper.hasClass("open")) {
                    $wrapper.removeClass("open");
                    $container.css('display', '');
                    $queryArea.css("z-index", "");
                }
            }
        });
        
        // 监听其他 Bootstrap-select 选择框打开时，关闭符文下拉框
        $(document).off("show.bs.select.pengciRuneDropdown").on("show.bs.select.pengciRuneDropdown", function(e) {
            if ($wrapper.hasClass("open")) {
                $wrapper.removeClass("open");
                $container.css('display', '');
                $queryArea.css("z-index", "");
            }
        });
        
        // 查询厨师配置按钮点击事件 - 复用贵客碰瓷的查询逻辑
        $("#btn-pengci-rune-query").off("click").on("click", function() {
            if (selectedRuneRecipes.length === 0) {
                if (typeof showAlert === 'function') {
                    showAlert('请先选择要碰瓷的菜谱');
                } else {
                    alert('请先选择要碰瓷的菜谱');
                }
                return;
            }
            
            // 临时保存贵客碰瓷的选中菜谱
            var tempPengciRecipes = selectedPengciRecipes.slice();
            
            // 将符文碰瓷的选中菜谱复制到贵客碰瓷的缓存中（rank默认为4-神级）
            selectedPengciRecipes = [];
            for (var i = 0; i < selectedRuneRecipes.length; i++) {
                selectedPengciRecipes.push({
                    guest: selectedRuneRecipes[i].guest,
                    recipe: selectedRuneRecipes[i].recipe,
                    rank: 4  // 神级
                });
            }
            
            // 执行查询
            var result = queryPengciChefConfig();
            
            // 恢复贵客碰瓷的选中菜谱
            selectedPengciRecipes = tempPengciRecipes;
            
            if (!result.success) {
                if (typeof showAlert === 'function') {
                    showAlert(result.message);
                } else {
                    alert(result.message);
                }
                return;
            }
            
            // 显示查询结果
            displayPengciQueryResult(result);
        });
    }
    
    /**
     * 构建符文碰瓷下拉菜单
     */
    function buildPengciRuneDropdown($container) {
        var gameData = (typeof calCustomRule !== 'undefined' && calCustomRule.gameData) 
                       ? calCustomRule.gameData : null;
        
        if (!gameData || !gameData.recipes) {
            $container.html('<div class="pengci-dropdown-empty">游戏数据未加载</div>');
            return;
        }
        
        var recipes = gameData.recipes || [];
        
        // 构建符文 -> 菜谱列表的映射
        // 使用菜谱的gift字段来匹配符文（参考show项目逻辑）
        // 结构: { runeName: [{ recipe }] }
        var runeRecipesMap = {};
        
        for (var i = 0; i < recipes.length; i++) {
            var recipe = recipes[i];
            
            // 检查菜谱的gift字段是否匹配符文
            if (!recipe.gift || recipe.gift === '-' || recipe.gift === '') {
                continue;
            }
            
            var runeName = recipe.gift;
            
            // 只添加已拥有的菜谱（兼容字符串"是"和布尔值true）
            if (recipe.got !== "是") {
                continue;
            }
            
            // 只添加未达到神级的菜谱（rank < 4）
            // rank: 可=1, 优=2, 特=3, 神=4, 传=5
            var rank = getPengciRankValue(recipe.rank);
            if (rank >= 4) {
                continue;
            }
            
            if (!runeRecipesMap[runeName]) {
                runeRecipesMap[runeName] = [];
            }
            
            runeRecipesMap[runeName].push({
                recipe: recipe
            });
        }
        
        // 对每个符文下的菜谱排序（参考show项目：按品级从高到低，然后按星级从低到高）
        for (var runeName in runeRecipesMap) {
            runeRecipesMap[runeName].sort(function(a, b) {
                var rankA = getPengciRankValue(a.recipe.rank);
                var rankB = getPengciRankValue(b.recipe.rank);
                if (rankB !== rankA) {
                    return rankB - rankA; // 品级从高到低
                }
                var rarityA = a.recipe.rarity || 0;
                var rarityB = b.recipe.rarity || 0;
                if (rarityA !== rarityB) {
                    return rarityA - rarityB; // 星级从低到高
                }
                return a.recipe.name.localeCompare(b.recipe.name);
            });
        }
        
        // 构建HTML
        var html = '';
        
        // 搜索框
        html += '<div class="pengci-search-wrapper">';
        html += '<input type="text" class="form-control pengci-search-input" placeholder="菜谱名称">';
        html += '</div>';
        
        // 已选菜谱展示区域
        html += '<div class="pengci-rune-selected-display"></div>';
        
        // 清空选择按钮
        html += '<div class="pengci-clear-wrapper">';
        html += '<button type="button" class="btn btn-default btn-sm btn-pengci-clear">清空选择</button>';
        html += '</div>';
        
        // 分类标签
        html += '<ul class="nav nav-tabs pengci-rune-category-tabs">';
        html += '<li class="' + (runeCategory === 'gold' ? 'active' : '') + '"><a href="#" data-category="gold">金符文</a></li>';
        html += '<li class="' + (runeCategory === 'silver' ? 'active' : '') + '"><a href="#" data-category="silver">银符文</a></li>';
        html += '<li class="' + (runeCategory === 'bronze' ? 'active' : '') + '"><a href="#" data-category="bronze">铜符文</a></li>';
        html += '</ul>';
        
        // 符文列表（按符文名称分组）
        html += '<div class="pengci-rune-list">';
        
        // 根据当前分类获取符文列表
        var allRunesList = [].concat(GOLD_RUNES, SILVER_RUNES, BRONZE_RUNES);
        
        for (var r = 0; r < allRunesList.length; r++) {
            var runeName = allRunesList[r];
            var runeType = 'bronze';
            if (GOLD_RUNES.indexOf(runeName) >= 0) runeType = 'gold';
            else if (SILVER_RUNES.indexOf(runeName) >= 0) runeType = 'silver';
            
            var runeRecipes = runeRecipesMap[runeName] || [];
            var recipeCount = runeRecipes.length;
            
            // 与贵客碰瓷格式一致：符文名 还可碰瓷 X 次
            var countText = recipeCount > 0 ? '还可碰瓷 ' + recipeCount + ' 次' : '无可碰瓷菜谱';
            var countClass = recipeCount > 0 ? 'pengci-count' : 'pengci-count no-pengci';
            
            html += '<div class="pengci-rune-section" data-rune="' + runeName + '" data-rune-type="' + runeType + '" data-pengci-count="' + recipeCount + '">';
            html += '<div class="pengci-rune-header">';
            html += '<span class="rune-name">' + runeName + '</span>';
            html += '<span class="' + countClass + '">' + countText + '</span>';
            html += '<span class="expand-arrow glyphicon glyphicon-chevron-down"></span>';
            html += '</div>';
            html += '<div class="pengci-rune-recipes" style="display: none;"></div>';
            html += '</div>';
        }
        html += '</div>';
        
        $container.html(html);
        
        // 绑定事件
        
        // 搜索框输入事件
        $container.find('.pengci-search-input').off('input').on('input', function() {
            var keyword = $(this).val().trim().toLowerCase();
            filterRuneSectionsByKeyword($container, keyword, runeRecipesMap);
        });
        
        // 分类标签点击事件
        $container.find('.pengci-rune-category-tabs a').off('click').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            var $tab = $(this);
            var category = $tab.attr('data-category');
            
            $tab.parent().addClass('active').siblings().removeClass('active');
            runeCategory = category;
            
            filterRuneSectionsByCategory($container, category);
            
            // 清空搜索框
            $container.find('.pengci-search-input').val('');
        });
        
        // 符文区块点击展开/收起（与贵客碰瓷逻辑一致）
        $container.find('.pengci-rune-header').off('click').on('click', function(e) {
            e.stopPropagation();
            
            var $header = $(this);
            var $section = $header.closest('.pengci-rune-section');
            var $recipesContainer = $section.find('.pengci-rune-recipes');
            var $arrow = $header.find('.expand-arrow');
            var runeName = $section.attr('data-rune');
            
            // 切换展开状态（与贵客碰瓷一致）
            if ($recipesContainer.is(':visible')) {
                // 收起
                $recipesContainer.slideUp(200);
                $arrow.removeClass('glyphicon-chevron-down').addClass('glyphicon-chevron-right');
                $section.removeClass('expanded');
            } else {
                // 展开 - 先加载菜谱内容
                var runeRecipes = runeRecipesMap[runeName] || [];
                var recipesHtml = generateRuneRecipesHtmlByRune(runeRecipes);
                $recipesContainer.html(recipesHtml);
                
                // 绑定菜谱点击事件
                $recipesContainer.find('.pengci-rune-recipe-inline').off('click').on('click', function(e) {
                    e.stopPropagation();
                    var $recipe = $(this);
                    var recipeName = $recipe.attr('data-recipe-name');
                    var guestName = $recipe.attr('data-guest-name');
                    
                    // 切换选中状态
                    var success = toggleRuneRecipeSelection(recipeName, guestName);
                    if (success) {
                        $recipe.toggleClass('selected');
                    }
                });
                
                // 更新已选中状态
                $recipesContainer.find('.pengci-rune-recipe-inline').each(function() {
                    var $recipe = $(this);
                    var recipeName = $recipe.attr('data-recipe-name');
                    var isSelected = findSelectedRuneRecipe(recipeName) !== null;
                    $recipe.toggleClass('selected', isSelected);
                });
                
                $recipesContainer.slideDown(200);
                $arrow.removeClass('glyphicon-chevron-right').addClass('glyphicon-chevron-down');
                $section.addClass('expanded');
            }
        });
        
        // 清空选择按钮点击事件
        $container.find('.btn-pengci-clear').off('click').on('click', function(e) {
            e.stopPropagation();
            selectedRuneRecipes = [];
            updateRuneDropdownText();
            updateRuneSelectedDisplay();
            $container.find('.pengci-rune-recipe-inline.selected').removeClass('selected');
        });
        
        // 应用当前分类过滤
        filterRuneSectionsByCategory($container, runeCategory);
        
        // 初始化已选菜谱展示区域
        updateRuneSelectedDisplay();
    }
    
    /**
     * 按符文分类过滤区块
     */
    function filterRuneSectionsByCategory($container, category) {
        $container.find('.pengci-rune-section').each(function() {
            var $section = $(this);
            var runeType = $section.attr('data-rune-type');
            $section.toggle(runeType === category);
        });
    }
    
    /**
     * 按关键词过滤符文区块（搜索菜谱名称）
     */
    function filterRuneSectionsByKeyword($container, keyword, runeRecipesMap) {
        if (!keyword) {
            // 无关键词时，按当前分类显示
            filterRuneSectionsByCategory($container, runeCategory);
            return;
        }
        
        $container.find('.pengci-rune-section').each(function() {
            var $section = $(this);
            var runeName = $section.attr('data-rune');
            var runeType = $section.attr('data-rune-type');
            
            // 检查当前分类
            if (runeType !== runeCategory) {
                $section.hide();
                return;
            }
            
            // 检查该符文下是否有匹配的菜谱名称
            var runeRecipes = runeRecipesMap[runeName] || [];
            var hasMatch = false;
            for (var i = 0; i < runeRecipes.length; i++) {
                var recipeName = runeRecipes[i].recipe.name || '';
                if (recipeName.toLowerCase().indexOf(keyword) >= 0) {
                    hasMatch = true;
                    break;
                }
            }
            
            $section.toggle(hasMatch);
        });
    }
    
    /**
     * 生成符文菜谱HTML（按符文分组）
     * 与贵客碰瓷格式一致：菜谱名、星级、技法值、升阶贵客
     */
    function generateRuneRecipesHtmlByRune(runeRecipes) {
        if (runeRecipes.length === 0) {
            return '<div class="pengci-recipe-empty-inline">没有可碰瓷的菜谱</div>';
        }
        
        var html = '';
        var rankLabels = ['优', '特', '神'];
        
        for (var i = 0; i < runeRecipes.length; i++) {
            var item = runeRecipes[i];
            var recipe = item.recipe;
            var currentRank = getPengciRankValue(recipe.rank);
            
            // 生成星级显示
            var stars = '';
            for (var s = 0; s < recipe.rarity; s++) {
                stars += '★';
            }
            
            // 生成技法值显示（与贵客碰瓷一致）
            var skillsHtml = '';
            var skillNames = { stirfry: '炒', boil: '煮', knife: '切', fry: '炸', bake: '烤', steam: '蒸' };
            var skillTypes = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
            var skillParts = [];
            for (var sk = 0; sk < skillTypes.length; sk++) {
                var skillType = skillTypes[sk];
                var skillVal = recipe[skillType] || 0;
                if (skillVal > 0) {
                    skillParts.push(skillNames[skillType] + skillVal);
                }
            }
            if (skillParts.length > 0) {
                skillsHtml = '<span class="recipe-skills">' + skillParts.join(' ') + '</span>';
            }
            
            // 生成升阶贵客列表（与贵客碰瓷格式一致）
            var guestsHtml = '';
            var recipeGuests = recipe.guests || [];
            for (var j = 0; j < Math.min(recipeGuests.length, 3); j++) {
                var recipeGuest = recipeGuests[j];
                var guestName = recipeGuest.guest || '';
                var rankLabel = rankLabels[j];
                var targetRank = j + 2; // 优=2, 特=3, 神=4
                var isCompleted = currentRank >= targetRank;
                
                var guestClass = 'pengci-inline-guest';
                if (isCompleted) {
                    guestClass += ' completed';
                }
                
                guestsHtml += '<span class="' + guestClass + '">' + rankLabel + '-' + guestName + '</span>';
            }
            
            // 获取第一个未完成的升阶贵客名称（用于选中时记录）
            var firstUncompletedGuest = '';
            for (var j = 0; j < Math.min(recipeGuests.length, 3); j++) {
                var targetRank = j + 2;
                if (currentRank < targetRank && recipeGuests[j].guest) {
                    firstUncompletedGuest = recipeGuests[j].guest;
                    break;
                }
            }
            
            var isSelected = findSelectedRuneRecipe(recipe.name) !== null;
            var selectedClass = isSelected ? ' selected' : '';
            
            // 使用与贵客碰瓷相同的class名：pengci-recipe-inline
            html += '<div class="pengci-recipe-inline pengci-rune-recipe-inline' + selectedClass + '" data-recipe-name="' + recipe.name + '" data-guest-name="' + firstUncompletedGuest + '">';
            html += '<div class="recipe-info">';
            html += '<span class="recipe-name">' + recipe.name + '<span class="check-mark">✓</span></span>';
            html += '<span class="recipe-stars">' + stars + '</span>';
            html += skillsHtml;
            html += '</div>';
            html += '<div class="recipe-guests">' + guestsHtml + '</div>';
            html += '</div>';
        }
        
        return html;
    }
    
    /**
     * 查找已选中的符文菜谱
     */
    function findSelectedRuneRecipe(recipeName) {
        for (var i = 0; i < selectedRuneRecipes.length; i++) {
            if (selectedRuneRecipes[i].recipe === recipeName) {
                return selectedRuneRecipes[i];
            }
        }
        return null;
    }
    
    /**
     * 切换符文菜谱选中状态
     */
    function toggleRuneRecipeSelection(recipeName, guestName) {
        var existingRecord = findSelectedRuneRecipe(recipeName);
        
        if (existingRecord) {
            // 已选中，取消选择
            var index = selectedRuneRecipes.indexOf(existingRecord);
            selectedRuneRecipes.splice(index, 1);
            updateRuneDropdownText();
            return true;
        } else {
            // 未选中，添加选择
            if (selectedRuneRecipes.length >= MAX_RUNE_RECIPES) {
                if (typeof showAlert === 'function') {
                    showAlert('最多只能选择' + MAX_RUNE_RECIPES + '道菜谱');
                }
                return false;
            }
            
            selectedRuneRecipes.push({
                guest: guestName,
                recipe: recipeName
            });
            updateRuneDropdownText();
            return true;
        }
    }
    
    /**
     * 更新符文下拉框显示文字
     */
    function updateRuneDropdownText() {
        var $text = $('#pengci-rune-dropdown-btn .pengci-dropdown-text');
        if (selectedRuneRecipes.length === 0) {
            $text.text('选择符文菜谱').removeClass('has-selection');
        } else if (selectedRuneRecipes.length === 1) {
            $text.text(selectedRuneRecipes[0].recipe).addClass('has-selection');
        } else {
            $text.text('已选择' + selectedRuneRecipes.length + '道菜').addClass('has-selection');
        }
        
        updateRuneSelectedDisplay();
    }
    
    /**
     * 更新符文已选菜谱展示区域
     */
    function updateRuneSelectedDisplay() {
        var $display = $('.pengci-rune-selected-display');
        if (!$display.length) return;
        
        if (selectedRuneRecipes.length === 0) {
            $display.empty().hide();
            return;
        }
        
        var html = '';
        for (var i = 0; i < selectedRuneRecipes.length; i++) {
            var item = selectedRuneRecipes[i];
            html += '<span class="pengci-selected-tag" data-recipe="' + item.recipe + '">';
            html += '<span class="tag-name">' + item.recipe + '</span>';
            html += '<span class="tag-remove">×</span>';
            html += '</span>';
        }
        
        $display.html(html).show();
        
        // 绑定移除按钮点击事件
        $display.find('.tag-remove').off('click').on('click', function(e) {
            e.stopPropagation();
            var $tag = $(this).closest('.pengci-selected-tag');
            var recipeName = $tag.attr('data-recipe');
            
            // 从选中列表中移除
            for (var i = 0; i < selectedRuneRecipes.length; i++) {
                if (selectedRuneRecipes[i].recipe === recipeName) {
                    selectedRuneRecipes.splice(i, 1);
                    break;
                }
            }
            
            // 更新显示
            updateRuneDropdownText();
            
            // 更新菜谱列表中的勾选状态
            $('.pengci-rune-recipe-inline[data-recipe-name="' + recipeName + '"]').removeClass('selected');
        });
    }

    // 更新暴露的公共接口
    return {
        init: init,
        calculateResults: calculateResults,
        calculateDualRecipe: calculateDualRecipe,
        calculateFields: calculateFields,
        updateSummaryDisplay: updateSummaryDisplay,
        isGuestRateMode: isGuestRateMode,
        analyzeChefGuestRateSkills: analyzeChefGuestRateSkills,
        initChefCategoryTabs: initChefCategoryTabs,
        clearChefOptionsCache: clearChefOptionsCache,
        checkGuestConflictsForSelectedRecipes: checkGuestConflictsForSelectedRecipes,
        refreshConflictDetection: refreshConflictDetection,
        displayGuestConflictWarning: displayGuestConflictWarning,
        refreshAllRecipeConflictDetection: refreshAllRecipeConflictDetection,
        addRuneAndGuestInfoToRecipeOption: addRuneAndGuestInfoToRecipeOption,
        getFilteredAndSortedChefs: getFilteredAndSortedChefs,
        // 碰瓷查询模块
        initPengciGuestSelect: initPengciGuestSelect,
        populatePengciGuestOptions: populatePengciGuestOptions,
        filterPengciGuestOptions: filterPengciGuestOptions,
        calculatePengciCount: calculatePengciCount,
        getMainlineGuests: getMainlineGuests,
        showPengciGuestRecipes: showPengciGuestRecipes,
        // 符文碰瓷模块
        initPengciRuneSelect: initPengciRuneSelect
    };
    
})(jQuery);
