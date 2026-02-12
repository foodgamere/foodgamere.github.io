/**
 * 未修炼厨师查询模块
 * 用于查询未修炼厨师的最佳菜谱组合
 * 支持NEXT厨师（只对紧邻的下一个厨师生效）和Partial厨师（对所有厨师生效）
 */

// ==================== 公共常量和函数 ====================

/**
 * 技法名称映射（英文 -> 中文）
 */
var SKILL_NAMES = {
    stirfry: '炒',
    boil: '煮',
    knife: '切',
    fry: '炸',
    bake: '烤',
    steam: '蒸'
};

/**
 * 技法类型数组
 */
var SKILL_TYPES = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];

/**
 * 品级名称映射（倍率 -> 中文简称）
 */
var GRADE_NAMES_SHORT = {
    5: '传',
    4: '神',
    3: '特',
    2: '优',
    1: '可'
};

/**
 * 品级名称映射（倍率 -> 中文全称）
 */
var GRADE_NAMES_FULL = {
    5: '传',
    4: '神',
    3: '特',
    2: '优',
    1: '可'
};

/**
 * 获取当前品级倍率
 * 神级方案模式：从设置页获取查询品级
 * 修炼查询模式：固定使用神级(4)
 * @returns {number} 品级倍率
 */
function getGradeMultiplier() {
    var isGodMode = $("#chk-cultivation-mode").prop("checked");
    return isGodMode ? (parseInt($("#select-recipe-god-grade").val()) || 4) : 4;
}

/**
 * 获取品级名称（简称）
 * @param {number} multiplier - 品级倍率（可选，默认使用当前设置）
 * @returns {string} 品级名称简称
 */
function getGradeNameShort(multiplier) {
    if (multiplier === undefined) {
        multiplier = getGradeMultiplier();
    }
    return GRADE_NAMES_SHORT[multiplier] || '神';
}

/**
 * 获取品级名称（全称）
 * @param {number} multiplier - 品级倍率（可选，默认使用当前设置）
 * @returns {string} 品级名称全称
 */
function getGradeNameFull(multiplier) {
    if (multiplier === undefined) {
        multiplier = getGradeMultiplier();
    }
    return GRADE_NAMES_FULL[multiplier] || '神级';
}

/**
 * 获取指定厨师位置的光环加成
 * @param {object} rule - 规则对象
 * @param {number} chefIndex - 厨师位置索引
 * @returns {array|null} 光环加成数组
 */
function getPartialAddsForChef(rule, chefIndex) {
    if (chefIndex === undefined || chefIndex === null || !rule || !rule.custom) {
        return null;
    }
    try {
        var customArray = [];
        for (var ci = 0; ci < rule.custom.length; ci++) {
            customArray.push(rule.custom[ci]);
        }
        var allPartialAdds = getPartialChefAdds(customArray, rule);
        return allPartialAdds[chefIndex] || null;
    } catch (e) {
        return null;
    }
}

// ==================== 修炼查询模式分类Tab ====================

// 保存当前选中的分类状态
var globalCultivationCategory = null;

// 保存原始的option HTML（用于恢复）
var cultivationOriginalOptionsHtml = {};

// 厨具分类状态
var globalCultivationEquipCategory = null;
var cultivationEquipOriginalOptionsHtml = {};

// 菜谱分类状态
var globalCultivationRecipeCategory = null;
var cultivationRecipeOriginalOptionsHtml = {};

// 光环厨师分组展开状态
var auraChefGroupExpandState = {};

/**
 * 为光环厨师分组添加折叠功能
 * @param {jQuery} $dropdown - 下拉菜单对象
 */
function addAuraChefCollapseFeature($dropdown) {
    // 为每个 optgroup 标签添加折叠功能
    $dropdown.find(".dropdown-header").each(function() {
        var $header = $(this);
        
        // 如果还没有添加折叠图标，则添加
        if (!$header.find(".collapse-icon").length) {
            // 添加可折叠类
            $header.addClass("collapsible");
            
            // 设置样式
            $header.css({
                'font-size': '15px',
                'cursor': 'pointer',
                'position': 'relative',
                'padding-right': '25px',
                'color': '#333'
            });
            
            // 使用 glyphicon 箭头样式（和贵客下拉框一致）
            var $icon = $("<span class='collapse-icon glyphicon glyphicon-chevron-right' style='position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10px;color:#999;'></span>");
            $header.append($icon);
            
            // 获取分组名称
            var headerText = $header.text().trim();
            var groupName = headerText.replace(/\s*\(\d+\)\s*$/, ''); // 移除 "(数量)" 部分
            
            // 检查是否有保存的展开状态，默认折叠
            var isCollapsed = true;
            if (auraChefGroupExpandState.hasOwnProperty(groupName)) {
                isCollapsed = auraChefGroupExpandState[groupName];
            } else {
                auraChefGroupExpandState[groupName] = true;
            }
            
            // 设置初始状态
            $header.data("collapsed", isCollapsed);
            $header.data("group-name", groupName);
            
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
            var groupName = $this.data("group-name");
            var $icon = $this.find(".collapse-icon");
            
            // 找到该 optgroup 下的所有选项
            var $options = $this.nextUntil(".dropdown-header", "li");
            
            if (isCollapsed) {
                // 展开 - 切换为向下箭头
                $options.slideDown(200);
                $icon.removeClass("glyphicon-chevron-right").addClass("glyphicon-chevron-down");
                $icon.css("color", "#337ab7");
                $this.data("collapsed", false);
                auraChefGroupExpandState[groupName] = false;
            } else {
                // 收起 - 切换为向右箭头
                $options.slideUp(200);
                $icon.removeClass("glyphicon-chevron-down").addClass("glyphicon-chevron-right");
                $icon.css("color", "#999");
                $this.data("collapsed", true);
                auraChefGroupExpandState[groupName] = true;
            }
        });
    });
}

/**
 * 初始化修炼查询模式的厨师分类标签
 * 在页面加载时调用，绑定shown.bs.select事件
 */
function initCultivationCategoryTabs() {
    
    $("select.select-picker-chef").on("shown.bs.select", function() {
        
        // 只在修炼查询模式下显示分类标签
        var isUnultimatedMode = calCustomRule && calCustomRule.isCultivate === true;
        var isGuestRateModeFlag = calCustomRule && calCustomRule.isGuestRate === true;
        
        // 判断是否为神级方案模式
        var isGodMode = $("#chk-cultivation-mode").prop("checked");
        
        
        // 如果不是修炼查询模式，或者是贵客率模式，移除分类标签
        if (!isUnultimatedMode || isGuestRateModeFlag) {
            $(this).parent().find('.dropdown-menu .cultivation-category-tabs').remove();
            return;
        }
        
        var $select = $(this);
        var selectId = $select.attr('id') || ('cultivation-select-' + Math.random().toString(36).substr(2, 9));
        $select.attr('id', selectId);
        
        var sp = $select.data('selectpicker');
        var $dropdown = sp && sp.$menu ? sp.$menu : $select.parent().find('.dropdown-menu');
        
        
        if (!$dropdown || !$dropdown.length) {
            return;
        }
        
        // 每次打开时都保存当前的 option HTML（获取最新数据）
        cultivationOriginalOptionsHtml[selectId] = $select.html();
        
        var tabsClass = "cultivation-category-tabs";
        
        // 获取品级名称（使用公共函数）
        var gradeName = getGradeNameFull();
        
        // 每次打开时都重新创建分类标签（以更新品级名称）
        $dropdown.find('.' + tabsClass).remove();
        
        var tabsHtml;
        if (isGodMode) {
            // 神级方案模式：显示品级推荐分类
            tabsHtml = '<ul class="nav nav-tabs ' + tabsClass + '" style="margin: 5px 10px; border-bottom: 1px solid #ddd;">' +
                '<li class="active"><a href="#" class="tab-god-recommend" data-category="god-recommend-chef-category" style="padding: 5px 10px; font-size: 12px;">' + gradeName + '级推荐</a></li>' +
                '<li><a href="#" class="tab-aura" data-category="aura-chef-category" style="padding: 5px 10px; font-size: 12px;">光环厨师</a></li>' +
                '<li><a href="#" class="tab-all" style="padding: 5px 10px; font-size: 12px;">全部</a></li>' +
                '</ul>';
        } else {
            // 修炼查询模式：显示"未修炼"分类
            tabsHtml = '<ul class="nav nav-tabs ' + tabsClass + '" style="margin: 5px 10px; border-bottom: 1px solid #ddd;">' +
                '<li class="active"><a href="#" class="tab-unultimated" data-category="unultimated-chef-category" style="padding: 5px 10px; font-size: 12px;">未修炼</a></li>' +
                '<li><a href="#" class="tab-aura" data-category="aura-chef-category" style="padding: 5px 10px; font-size: 12px;">光环厨师</a></li>' +
                '<li><a href="#" class="tab-all" style="padding: 5px 10px; font-size: 12px;">全部</a></li>' +
                '</ul>';
        }
        
        var $searchBox = $dropdown.find('.bs-searchbox');
        if ($searchBox.length) {
            $searchBox.after(tabsHtml);
        } else {
            $dropdown.prepend(tabsHtml);
        }
        
        // 绑定标签点击事件
        $dropdown.find('.' + tabsClass + ' a').off('click').on('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            var $tab = $(this);
            var categoryName = $tab.attr('data-category') || null;
            
            // 更新标签状态
            $tab.parent().addClass('active').siblings().removeClass('active');
            
            // 保存分类状态
            globalCultivationCategory = { category: categoryName };
            
            // 过滤厨师列表
            filterCultivationChefs($select, selectId, categoryName, isGodMode);
            
            return false;
        });
        
        // 恢复之前选中的分类状态，或默认选择第一个分类
        var defaultCategory = isGodMode ? 'god-recommend-chef-category' : 'unultimated-chef-category';
        var defaultTabClass = isGodMode ? '.tab-god-recommend' : '.tab-unultimated';
        
        if (globalCultivationCategory && globalCultivationCategory.category !== null) {
            $dropdown.find('.' + tabsClass + ' li').removeClass('active');
            var $targetTab = $dropdown.find('.' + tabsClass + ' a[data-category="' + globalCultivationCategory.category + '"]');
            if ($targetTab.length) {
                $targetTab.parent().addClass('active');
                // 应用过滤
                filterCultivationChefs($select, selectId, globalCultivationCategory.category, isGodMode);
            } else {
                // 默认选择第一个分类
                $dropdown.find(defaultTabClass).parent().addClass('active');
                globalCultivationCategory = { category: defaultCategory };
                filterCultivationChefs($select, selectId, defaultCategory, isGodMode);
            }
        } else {
            // 初始化时默认选择第一个分类
            globalCultivationCategory = { category: defaultCategory };
            filterCultivationChefs($select, selectId, defaultCategory, isGodMode);
        }
    });
    
    // 厨具选择框分类标签
    $("select.select-picker-equip").on("shown.bs.select", function() {
        // 只在修炼查询模式下显示分类标签
        var isUnultimatedMode = calCustomRule && calCustomRule.isCultivate === true;
        var isGuestRateModeFlag = calCustomRule && calCustomRule.isGuestRate === true;
        
        // 判断是否为神级方案模式
        var isGodMode = $("#chk-cultivation-mode").prop("checked");
        
        // 如果不是修炼查询模式，或者是贵客率模式，移除分类标签
        if (!isUnultimatedMode || isGuestRateModeFlag) {
            $(this).parent().find('.dropdown-menu .cultivation-equip-category-tabs').remove();
            return;
        }
        
        var $select = $(this);
        var selectId = $select.attr('id') || ('cultivation-equip-select-' + Math.random().toString(36).substr(2, 9));
        $select.attr('id', selectId);
        
        var sp = $select.data('selectpicker');
        var $dropdown = sp && sp.$menu ? sp.$menu : $select.parent().find('.dropdown-menu');
        
        if (!$dropdown || !$dropdown.length) {
            return;
        }
        
        // 每次打开时都保存当前的 option HTML（获取最新数据）
        cultivationEquipOriginalOptionsHtml[selectId] = $select.html();
        
        var tabsClass = "cultivation-equip-category-tabs";
        
        // 获取品级名称（使用公共函数）
        var gradeName = getGradeNameFull();
        
        // 每次打开时都重新创建分类标签（以更新品级名称）
        $dropdown.find('.' + tabsClass).remove();
        
        // 创建分类标签
        var tabsHtml = '<ul class="nav nav-tabs ' + tabsClass + '" style="margin: 5px 10px; border-bottom: 1px solid #ddd;">' +
            '<li class="active"><a href="#" class="tab-god-recommend" data-category="god-recommend-category" style="padding: 5px 10px; font-size: 12px;">' + gradeName + '级推荐</a></li>' +
            '<li><a href="#" class="tab-all" style="padding: 5px 10px; font-size: 12px;">全部</a></li>' +
            '</ul>';
        
        var $searchBox = $dropdown.find('.bs-searchbox');
        if ($searchBox.length) {
            $searchBox.after(tabsHtml);
        } else {
            $dropdown.prepend(tabsHtml);
        }
        
        // 绑定标签点击事件
        $dropdown.find('.' + tabsClass + ' a').off('click').on('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            var $tab = $(this);
            var categoryName = $tab.attr('data-category') || null;
            
            // 更新标签状态
            $tab.parent().addClass('active').siblings().removeClass('active');
            
            // 保存分类状态
            globalCultivationEquipCategory = { category: categoryName };
            
            // 过滤厨具列表（神级推荐逻辑暂不实现，只保持全部逻辑）
            filterCultivationEquips($select, selectId, categoryName);
            
            return false;
        });
        
        // 恢复之前选中的分类状态，或默认选择第一个分类（神级推荐）
        if (globalCultivationEquipCategory && globalCultivationEquipCategory.category !== null) {
            $dropdown.find('.' + tabsClass + ' li').removeClass('active');
            var $targetTab = $dropdown.find('.' + tabsClass + ' a[data-category="' + globalCultivationEquipCategory.category + '"]');
            if ($targetTab.length) {
                $targetTab.parent().addClass('active');
                // 应用过滤
                filterCultivationEquips($select, selectId, globalCultivationEquipCategory.category);
            } else {
                // 默认选择第一个分类
                $dropdown.find('.tab-god-recommend').parent().addClass('active');
                globalCultivationEquipCategory = { category: 'god-recommend-category' };
                filterCultivationEquips($select, selectId, 'god-recommend-category');
            }
        } else {
            // 初始化时默认选择第一个分类（神级推荐）
            globalCultivationEquipCategory = { category: 'god-recommend-category' };
            filterCultivationEquips($select, selectId, 'god-recommend-category');
        }
        
        // 在所有操作完成后，绑定菜单列表项的点击事件（确保事件有效）
        setTimeout(function() {
            var spAfter = $select.data('selectpicker');
            if (spAfter && spAfter.$menu) {
                // 绑定到 .inner 内的列表项
                spAfter.$menu.find('.dropdown-menu.inner').off('click.equipSelectShown').on('click.equipSelectShown', 'li', function(evt) {
                    // 忽略分类标签的点击
                    if ($(this).closest('.cultivation-equip-category-tabs').length) {
                        return;
                    }
                    
                    var $li = $(this);
                    var index = $li.attr('data-original-index') || $li.data('original-index');
                    
                    // 通过 index 获取选中的值
                    var selectedValue = null;
                    if (index !== undefined && index !== null) {
                        var $option = $select.find('option').eq(parseInt(index));
                        if ($option.length) {
                            selectedValue = $option.val();
                        }
                    }
                    
                    // 如果通过 index 没找到，尝试通过文本匹配
                    if (selectedValue === null) {
                        var liText = $li.text().trim();
                        $select.find('option').each(function() {
                            var optText = $(this).text().trim();
                            if (optText === liText || liText.indexOf(optText) >= 0 || optText.indexOf(liText.substring(0, 10)) >= 0) {
                                selectedValue = $(this).val();
                                return false;
                            }
                        });
                    }
                    
                    
                    if (selectedValue !== null && selectedValue !== undefined) {
                        var ruleIndex = $(".cal-custom-item").index($select.closest(".cal-custom-item"));
                        var chefIndex = $select.closest(".cal-custom-item").find(".selected-item").index($select.closest(".selected-item"));
                        if (typeof setCustomEquip === 'function') {
                            setCustomEquip(ruleIndex, chefIndex, selectedValue);
                        }
                        if (typeof calCustomResults === 'function' && typeof calCustomRule !== 'undefined' && calCustomRule.gameData) {
                            calCustomResults(calCustomRule.gameData);
                        }
                    }
                });
            }
        }, 50);
    });
    
    // 菜谱选择框分类标签
    $("select.select-picker-recipe").on("shown.bs.select", function() {
        // 只在修炼查询模式下显示分类标签
        var isUnultimatedMode = calCustomRule && calCustomRule.isCultivate === true;
        var isGuestRateModeFlag = calCustomRule && calCustomRule.isGuestRate === true;
        
        // 判断是否为神级方案模式
        var isGodMode = $("#chk-cultivation-mode").prop("checked");
        
        // 如果不是修炼查询模式，或者是贵客率模式，或者是神级方案模式，移除分类标签
        if (!isUnultimatedMode || isGuestRateModeFlag || isGodMode) {
            $(this).parent().find('.dropdown-menu .cultivation-recipe-category-tabs').remove();
            
            // 神级方案模式：按最高单技法值降序排序
            if (isGodMode && isUnultimatedMode && !isGuestRateModeFlag) {
                var $select = $(this);
                var sp = $select.data('selectpicker');
                if (sp) {
                    sortRecipesByMaxSkill($select);
                    sp.refresh();
                }
            }
            return;
        }
        
        var $select = $(this);
        var selectId = $select.attr('id') || ('cultivation-recipe-select-' + Math.random().toString(36).substr(2, 9));
        $select.attr('id', selectId);
        
        var sp = $select.data('selectpicker');
        var $dropdown = sp && sp.$menu ? sp.$menu : $select.parent().find('.dropdown-menu');
        
        if (!$dropdown || !$dropdown.length) {
            return;
        }
        
        // 每次打开时都保存当前的 option HTML（获取最新数据）
        cultivationRecipeOriginalOptionsHtml[selectId] = $select.html();
        
        var tabsClass = "cultivation-recipe-category-tabs";
        
        // 创建分类标签（如果不存在）
        if (!$dropdown.find('.' + tabsClass).length) {
            var tabsHtml = '<ul class="nav nav-tabs ' + tabsClass + '" style="margin: 5px 10px; border-bottom: 1px solid #ddd;">' +
                '<li class="active"><a href="#" class="tab-quest" data-category="quest-recipe-category" style="padding: 5px 10px; font-size: 12px;">修炼可用菜谱</a></li>' +
                '<li><a href="#" class="tab-all" style="padding: 5px 10px; font-size: 12px;">全部</a></li>' +
                '</ul>';
            
            var $searchBox = $dropdown.find('.bs-searchbox');
            if ($searchBox.length) {
                $searchBox.after(tabsHtml);
            } else {
                $dropdown.prepend(tabsHtml);
            }
        }
        
        // 绑定标签点击事件
        $dropdown.find('.' + tabsClass + ' a').off('click').on('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            var $tab = $(this);
            var categoryName = $tab.attr('data-category') || null;
            
            // 更新标签状态
            $tab.parent().addClass('active').siblings().removeClass('active');
            
            // 保存分类状态
            globalCultivationRecipeCategory = { category: categoryName };
            
            // 过滤菜谱列表
            filterCultivationRecipes($select, selectId, categoryName);
            
            return false;
        });
        
        // 恢复之前选中的分类状态，或默认选择第一个分类（修炼任务）
        if (globalCultivationRecipeCategory && globalCultivationRecipeCategory.category !== null) {
            $dropdown.find('.' + tabsClass + ' li').removeClass('active');
            var $targetTab = $dropdown.find('.' + tabsClass + ' a[data-category="' + globalCultivationRecipeCategory.category + '"]');
            if ($targetTab.length) {
                $targetTab.parent().addClass('active');
                // 应用过滤
                filterCultivationRecipes($select, selectId, globalCultivationRecipeCategory.category);
            } else {
                // 默认选择第一个分类
                $dropdown.find('.tab-quest').parent().addClass('active');
                globalCultivationRecipeCategory = { category: 'quest-recipe-category' };
                filterCultivationRecipes($select, selectId, 'quest-recipe-category');
            }
        } else {
            // 初始化时默认选择第一个分类（修炼任务）
            globalCultivationRecipeCategory = { category: 'quest-recipe-category' };
            filterCultivationRecipes($select, selectId, 'quest-recipe-category');
        }
    });
}

/**
 * 根据分类过滤厨具列表（修改option元素，然后刷新selectpicker）
 */
function filterCultivationEquips($select, selectId, categoryName) {
    var sp = $select.data('selectpicker');
    if (!sp) return;
    
    // 保存当前选中的值
    var currentValue = $select.val();
    
    // 保存当前的搜索关键词
    var $searchInput = sp.$menu.find('.bs-searchbox input');
    var searchKeyword = $searchInput.length ? $searchInput.val() : '';
    
    // 移除之前的空提示
    sp.$menu.find('.cultivation-equip-empty-tip').remove();
    
    // 获取品级名称（使用公共函数）
    var gradeName = getGradeNameFull();
    
    // 根据分类选择使用哪个选项列表
    if (categoryName === 'god-recommend-category') {
        // 品级推荐：使用过滤后的选项
        var originalHtml = cultivationEquipOriginalOptionsHtml[selectId];
        if (originalHtml) {
            $select.html(originalHtml);
        }
        
        // 从当前选项中提取所有厨具ID（这些是已经被sortEquipsForCultivation筛选过的）
        var currentEquipIds = [];
        $select.find('option').each(function() {
            var equipId = $(this).val();
            if (equipId && equipId !== "") {
                currentEquipIds.push(String(equipId));
            }
        });
        
        // 获取所有厨具的可提升信息和差值信息
        var equipInfo = getGodRecommendEquipInfoForAll($select, currentEquipIds);
        
        // 为每个厨具添加可提升信息或差值信息
        $select.find('option').each(function() {
            var $opt = $(this);
            var equipId = $opt.val();
            
            // 跳过占位项（无厨具）
            if (equipId === "" || equipId === null) {
                return;
            }
            
            // 神级推荐分类中，移除warning-skill class，防止厨具名变红
            var currentClass = $opt.attr('class') || '';
            if (currentClass.indexOf('warning-skill') >= 0) {
                $opt.attr('class', currentClass.replace(/warning-skill/g, '').trim());
            }
            
            // 添加品级信息或差值信息到选项内容
            if (equipInfo && equipInfo[String(equipId)]) {
                var info = equipInfo[String(equipId)];
                var currentContent = $opt.attr('data-content') || $opt.text();
                var infoHtml = '';
                
                if (info.godRecipeNames && info.godRecipeNames.length > 0) {
                    // 能使菜谱达标：显示可提升信息
                    infoHtml = '<span style="color:#333;font-size:11px;margin-left:5px;">可提升(<span style="color:#337ab7;">' + info.godRecipeNames.join('、') + '</span>)为' + gradeName + '</span>';
                } else if (info.totalDeficit !== undefined && info.totalDeficit <= 300) {
                    // 差值300以内：显示详细差值信息（包含技法类型）
                    var deficitText = info.deficitDetail || (gradeName + '差值:' + info.totalDeficit);
                    infoHtml = '<span style="color:#dc3545;font-size:11px;margin-left:5px;">' + gradeName + '差值: ' + deficitText + '</span>';
                }
                
                if (infoHtml) {
                    // 在星级后添加信息（星级格式：<span class='subtext'>★★★</span>）
                    var subtextMatch = currentContent.match(/<span class=['"]subtext['"]>[^<]*<\/span>/);
                    if (subtextMatch) {
                        // 找到星级span，在其后插入信息
                        var subtextEndIndex = currentContent.indexOf(subtextMatch[0]) + subtextMatch[0].length;
                        currentContent = currentContent.substring(0, subtextEndIndex) + infoHtml + currentContent.substring(subtextEndIndex);
                    } else if (currentContent.indexOf('</span>') > 0) {
                        // 没找到星级span，在厨具名后面插入
                        var firstSpanEnd = currentContent.indexOf('</span>') + 7;
                        currentContent = currentContent.substring(0, firstSpanEnd) + infoHtml + currentContent.substring(firstSpanEnd);
                    } else {
                        currentContent += infoHtml;
                    }
                    $opt.attr('data-content', currentContent);
                }
            }
        });
        
        // 不再显示"无推荐厨具"提示
    } else {
        // 全部分类：使用完整的选项列表
        var fullHtml = window.cultivationEquipFullOptionsHtml && window.cultivationEquipFullOptionsHtml[selectId];
        if (fullHtml) {
            $select.html(fullHtml);
        } else {
            // 如果没有保存完整选项，使用原始选项
            var originalHtml = cultivationEquipOriginalOptionsHtml[selectId];
            if (originalHtml) {
                $select.html(originalHtml);
            }
        }
    }
    
    // 恢复选中的值
    $select.val(currentValue);
    
    // 刷新selectpicker
    sp.refresh();
    
    // 重新绑定事件（确保事件能正确触发）
    $select.off("changed.bs.select change hidden.bs.select").on("changed.bs.select change", function(evt) {
        var ruleIndex = $(".cal-custom-item").index($(this).closest(".cal-custom-item"));
        var chefIndex = $(this).closest(".cal-custom-item").find(".selected-item").index($(this).closest(".selected-item"));
        var equipId = $(this).val();
        if (typeof setCustomEquip === 'function') {
            setCustomEquip(ruleIndex, chefIndex, equipId);
        }
        if (typeof calCustomResults === 'function' && typeof calCustomRule !== 'undefined' && calCustomRule.gameData) {
            calCustomResults(calCustomRule.gameData);
        }
    });
    
    // 使用 hidden.bs.select 事件作为备用（在下拉菜单关闭时触发）
    $select.on("hidden.bs.select", function(evt) {
        var ruleIndex = $(".cal-custom-item").index($(this).closest(".cal-custom-item"));
        var chefIndex = $(this).closest(".cal-custom-item").find(".selected-item").index($(this).closest(".selected-item"));
        var equipId = $(this).val();
        if (equipId && typeof setCustomEquip === 'function') {
            setCustomEquip(ruleIndex, chefIndex, equipId);
        }
        if (typeof calCustomResults === 'function' && typeof calCustomRule !== 'undefined' && calCustomRule.gameData) {
            calCustomResults(calCustomRule.gameData);
        }
    });
    
    // 重新绑定菜单点击事件（确保在刷新后事件仍然有效）
    if (sp && sp.$menu) {
        // 绑定到 .inner 内的列表项
        sp.$menu.find('.dropdown-menu.inner').off('click.equipSelectFilter').on('click.equipSelectFilter', 'li', function(evt) {
            // 忽略分类标签的点击
            if ($(this).closest('.cultivation-equip-category-tabs').length) {
                return;
            }
            
            var $li = $(this);
            var index = $li.attr('data-original-index') || $li.data('original-index');
            
            // 通过 index 获取选中的值
            var selectedValue = null;
            if (index !== undefined && index !== null) {
                var $option = $select.find('option').eq(parseInt(index));
                if ($option.length) {
                    selectedValue = $option.val();
                }
            }
            
            // 如果通过 index 没找到，尝试通过文本匹配
            if (selectedValue === null) {
                var liText = $li.text().trim();
                $select.find('option').each(function() {
                    var optText = $(this).text().trim();
                    if (optText === liText || liText.indexOf(optText) >= 0 || optText.indexOf(liText.substring(0, 10)) >= 0) {
                        selectedValue = $(this).val();
                        return false;
                    }
                });
            }
            
            
            if (selectedValue !== null && selectedValue !== undefined) {
                var ruleIndex = $(".cal-custom-item").index($select.closest(".cal-custom-item"));
                var chefIndex = $select.closest(".cal-custom-item").find(".selected-item").index($select.closest(".selected-item"));
                if (typeof setCustomEquip === 'function') {
                    setCustomEquip(ruleIndex, chefIndex, selectedValue);
                }
                if (typeof calCustomResults === 'function' && typeof calCustomRule !== 'undefined' && calCustomRule.gameData) {
                    calCustomResults(calCustomRule.gameData);
                }
            }
        });
    }
    
    // 重新应用搜索关键词（如果有）
    if (searchKeyword) {
        setTimeout(function() {
            var $newSearchInput = sp.$menu.find('.bs-searchbox input');
            if ($newSearchInput.length) {
                $newSearchInput.val(searchKeyword);
                $newSearchInput.trigger('input');
            }
        }, 0);
    }
}

/**
 * 获取满足厨师修炼任务条件的菜谱ID列表（用于getCustomRecipesOptions）
 * 条件：满足技法要求、星级要求，不需要满足品级要求
 * 排序：品级降序 > 神差值升序 > 时间升序 > 任务要求星级优先
 */
function getQuestMatchingRecipeIdsForOptions(ruleIndex, chefIndex, chef) {
    if (!chef || !chef.chefId) {
        return null;
    }
    
    var rule = calCustomRule.rules[ruleIndex];
    if (!rule) {
        return null;
    }
    
    // 获取厨师的第一个修炼任务
    var quest = getChefFirstUltimateQuestForCultivation(chef.chefId);
    
    if (!quest || !quest.conditions) {
        return null;
    }
    
    // 获取任务要求的星级（rarity）
    var questRarity = 0;
    for (var c = 0; c < quest.conditions.length; c++) {
        if (quest.conditions[c].rarity) {
            questRarity = quest.conditions[c].rarity;
            break;
        }
    }
    
    // 获取可用菜谱列表
    var menus = rule.menus || [];
    var gotChecked = $("#chk-cal-got").prop("checked");
    
    // 筛选满足修炼任务条件的菜谱（不检查品级）
    var matchingRecipes = [];
    
    for (var i = 0; i < menus.length; i++) {
        var recipe = menus[i].recipe && menus[i].recipe.data;
        if (!recipe || !recipe.recipeId) continue;
        
        // 检查是否已拥有
        if (gotChecked && !recipe.got) continue;
        
        // 检查是否满足修炼任务条件（不检查品级）
        if (checkRecipeMatchQuestConditionsWithoutRank(recipe, quest)) {
            // 计算神差值（达到神级需要的技法差值）
            var skillDiff = calculateSkillDiffForQuestRecipe(chef, recipe);
            
            // 计算品级（根据厨师技法判断能达到的最高品级）
            var rank = calculateRecipeRank(chef, recipe);
            
            matchingRecipes.push({
                recipeId: String(recipe.recipeId),
                recipe: recipe,
                rank: rank,
                skillDiff: skillDiff,
                time: recipe.time || 0,
                rarity: recipe.rarity || 0,
                questRarity: questRarity
            });
        }
    }
    
    // 排序：品级降序 > 神差值升序 > 时间升序 > 任务要求星级优先
    matchingRecipes.sort(function(a, b) {
        if (b.rank !== a.rank) return b.rank - a.rank;
        if (a.skillDiff !== b.skillDiff) return a.skillDiff - b.skillDiff;
        if (a.time !== b.time) return a.time - b.time;
        var aRarityMatch = (a.rarity === a.questRarity) ? 0 : 1;
        var bRarityMatch = (b.rarity === b.questRarity) ? 0 : 1;
        if (aRarityMatch !== bRarityMatch) return aRarityMatch - bRarityMatch;
        return a.rarity - b.rarity;
    });
    
    // 返回排序后的菜谱ID列表
    var result = [];
    for (var i = 0; i < matchingRecipes.length; i++) {
        result.push(matchingRecipes[i].recipeId);
    }
    
    return result;
}

/**
 * 根据分类过滤菜谱列表
 */
function filterCultivationRecipes($select, selectId, categoryName) {
    var sp = $select.data('selectpicker');
    if (!sp) return;
    
    // 保存当前选中的值
    var currentValue = $select.val();
    
    // 保存当前的搜索关键词
    var $searchInput = sp.$menu.find('.bs-searchbox input');
    var searchKeyword = $searchInput.length ? $searchInput.val() : '';
    
    // 根据分类选择使用缓存的选项列表
    if (categoryName === 'quest-recipe-category') {
        // 修炼任务分类：使用缓存的修炼任务选项
        var questHtml = window.cultivationRecipeQuestOptionsHtml && window.cultivationRecipeQuestOptionsHtml[selectId];
        if (questHtml) {
            $select.html(questHtml);
        } else {
            // 如果没有缓存，使用原始选项
            var originalHtml = cultivationRecipeOriginalOptionsHtml[selectId];
            if (originalHtml) {
                $select.html(originalHtml);
            }
        }
    } else {
        // 全部分类：使用缓存的完整选项列表
        var fullHtml = window.cultivationRecipeFullOptionsHtml && window.cultivationRecipeFullOptionsHtml[selectId];
        if (fullHtml) {
            $select.html(fullHtml);
        } else {
            // 如果没有缓存，使用原始选项
            var originalHtml = cultivationRecipeOriginalOptionsHtml[selectId];
            if (originalHtml) {
                $select.html(originalHtml);
            }
        }
    }
    
    // 恢复选中的值
    $select.val(currentValue);
    
    // 刷新selectpicker
    sp.refresh();
    
    // 重新应用搜索关键词（如果有）
    if (searchKeyword) {
        setTimeout(function() {
            var $newSearchInput = sp.$menu.find('.bs-searchbox input');
            if ($newSearchInput.length) {
                $newSearchInput.val(searchKeyword);
                $newSearchInput.trigger('input');
            }
        }, 0);
    }
}

/**
 * 计算厨师做菜谱的差值（达到目标品级需要的技法差值总和）
 * 神级方案模式：品级倍率根据设置页的查询品级动态计算（传=5, 神=4, 特=3, 优=2, 可=1）
 * 修炼查询模式：固定使用神级倍率(4)
 */
function calculateSkillDiffForQuestRecipe(chef, recipe) {
    var totalDiff = 0;
    // 使用公共函数获取品级倍率
    var gradeMultiplier = getGradeMultiplier();
    
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        var skill = SKILL_TYPES[i];
        var recipeNeed = recipe[skill] || 0;
        if (recipeNeed > 0) {
            var chefVal = chef[skill + 'Val'] || 0;
            var required = recipeNeed * gradeMultiplier;
            var diff = required - chefVal;
            if (diff > 0) {
                totalDiff += diff;
            }
        }
    }
    
    return totalDiff;
}

/**
 * 计算厨师对多个菜谱的技法差值详情（用于神级推荐显示）
 * 返回总差值和详细差值字符串
 * @param chef - 厨师数据（原始数据，需要计算技法值）
 * @param recipes - 菜谱数组
 * @param gradeMultiplier - 品级倍率
 * @param rule - 规则对象（可选，用于计算技法值）
 */
function calculateSkillDiffDetailForGodRecommend(chef, recipes, gradeMultiplier, rule, chefIndex) {
    // 获取"已配厨具"和"已配遗玉"复选框状态
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    var useAmber = $("#chk-cal-use-amber").prop("checked");
    
    // 深拷贝厨师数据，避免修改原数据
    var chefCopy = JSON.parse(JSON.stringify(chef));
    
    // 如果有rule，使用setDataForChef计算包含厨具/遗玉/光环加成的技法值
    if (rule && typeof setDataForChef === 'function') {
        var equipToUse = null;
        var isGodMode = $("#chk-cultivation-mode").prop("checked");
        
        if (isGodMode) {
            // 神级方案模式：如果勾选了"已配厨具"，使用厨师自己佩戴的厨具
            if (useEquip) {
                equipToUse = chefCopy.equip;
            } else if (rule.custom && chefIndex !== undefined && chefIndex !== null) {
                // 没勾选"已配厨具"时，使用场上该位置的厨具
                var customData = rule.custom[chefIndex];
                if (customData && customData.equip && customData.equip.equipId) {
                    equipToUse = customData.equip;
                }
            }
        } else {
            // 非神级方案模式：保持原逻辑
            if (rule.custom && chefIndex !== undefined && chefIndex !== null) {
                var customData = rule.custom[chefIndex];
                if (customData && customData.equip && customData.equip.equipId) {
                    equipToUse = customData.equip;
                }
            }
            if (!equipToUse && useEquip) {
                equipToUse = chefCopy.equip;
            }
        }
        
        // 如果不使用已配遗玉，清空遗玉数据
        if (!useAmber && chefCopy.disk && chefCopy.disk.ambers) {
            for (var j = 0; j < chefCopy.disk.ambers.length; j++) {
                chefCopy.disk.ambers[j].data = null;
            }
        }
        
        // 获取光环加成（使用公共函数）
        var partialAdds = getPartialAddsForChef(rule, chefIndex);
        
        // 调用setDataForChef计算技法值
        setDataForChef(
            chefCopy,                           // 厨师
            equipToUse,                         // 厨具（如果勾选了已配厨具）
            true,                               // 是否计算
            rule.calGlobalUltimateData,         // 全局修炼数据
            partialAdds,                        // 光环加成
            rule.calSelfUltimateData,           // 自身修炼数据
            rule.calActivityUltimateData,       // 活动修炼数据
            true,                               // 是否使用修炼
            rule,                               // 规则
            useAmber,                           // 是否使用遗玉
            rule.calQixiaData || null           // 奇侠数据
        );
    }
    
    // 计算所有菜谱需要的最大技法值
    var maxRequired = {};
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        maxRequired[SKILL_TYPES[i]] = 0;
    }
    
    for (var r = 0; r < recipes.length; r++) {
        var recipe = recipes[r];
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            var recipeNeed = recipe[skill] || 0;
            if (recipeNeed > 0) {
                var required = recipeNeed * gradeMultiplier;
                if (required > maxRequired[skill]) {
                    maxRequired[skill] = required;
                }
            }
        }
    }
    
    // 计算差值
    var totalDiff = 0;
    var diffParts = [];
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        var skill = SKILL_TYPES[i];
        if (maxRequired[skill] > 0) {
            var chefVal = chefCopy[skill + 'Val'] || chefCopy[skill] || 0;
            var diff = maxRequired[skill] - chefVal;
            if (diff > 0) {
                totalDiff += diff;
                diffParts.push(SKILL_NAMES[skill] + '-' + diff);
            }
        }
    }
    
    return {
        totalDiff: totalDiff,
        disp: diffParts.length > 0 ? diffParts.join(' ') : ''
    };
}

/**
 * 获取菜谱的最高单技法值
 */
function getRecipeMaxSkillValue(recipe) {
    var maxVal = 0;
    
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        var skill = SKILL_TYPES[i];
        var val = recipe[skill] || 0;
        if (val > maxVal) {
            maxVal = val;
        }
    }
    
    return maxVal;
}

/**
 * 按品级降序，同品级按差值升序排序（用于神级方案模式）
 * 没有厨师时按最高技法值降序
 */
function sortRecipesByMaxSkill($select) {
    // 保存当前选中的值
    var currentValue = $select.val();
    
    // 获取当前厨师 - 从rule.custom中获取已计算好技法值的厨师
    var $recipeBox = $select.closest('.recipe-box');
    var $selectedItem = $recipeBox.closest('.selected-item');
    var selectedItemIndex = $selectedItem.index();
    var chef = null;
    
    var rule = calCustomRule && calCustomRule.rules && calCustomRule.rules[0];
    if (rule && rule.custom && rule.custom[selectedItemIndex]) {
        var customChef = rule.custom[selectedItemIndex].chef;
        if (customChef && customChef.chefId) {
            chef = customChef;
        }
    }
    
    // 获取查询品级
    var gradeMultiplier = parseInt($("#select-recipe-god-grade").val()) || 4;
    
    // 收集所有菜谱选项
    var recipeOptions = [];
    $select.find('option').each(function() {
        var $opt = $(this);
        var recipeId = $opt.val();
        
        // 保留占位项
        if (recipeId === "" || recipeId === null || $opt.text().trim() === "") {
            recipeOptions.push({ $opt: $opt, isPlaceholder: true, rank: 0, diff: 0, maxSkill: 0 });
            return;
        }
        
        var rank = 0;
        var diff = 0;
        var maxSkill = 0;
        
        // 从rule.menus中获取菜谱数据
        if (rule && rule.menus) {
            for (var i = 0; i < rule.menus.length; i++) {
                var menu = rule.menus[i];
                if (menu.recipe && menu.recipe.data && String(menu.recipe.data.recipeId) === String(recipeId)) {
                    var recipe = menu.recipe.data;
                    // 获取最高技法值（用于没有厨师时排序）
                    if (typeof getRecipeMaxSkillValue === 'function') {
                        maxSkill = getRecipeMaxSkillValue(recipe);
                    }
                    // 有厨师时计算品级和差值
                    if (chef) {
                        if (typeof calculateRecipeRank === 'function') {
                            rank = calculateRecipeRank(chef, recipe);
                        }
                        if (typeof getSkillDiff === 'function') {
                            var skillDiffObj = getSkillDiff(chef, recipe, gradeMultiplier);
                            diff = skillDiffObj.value || 0;
                        }
                    }
                    break;
                }
            }
        }
        
        recipeOptions.push({ $opt: $opt, isPlaceholder: false, rank: rank, diff: diff, maxSkill: maxSkill, recipeId: recipeId });
    });
    
    // 排序逻辑
    if (chef) {
        // 有厨师：按品级降序，同品级按差值升序
        recipeOptions.sort(function(a, b) {
            if (a.isPlaceholder) return -1;
            if (b.isPlaceholder) return 1;
            if (b.rank !== a.rank) return b.rank - a.rank;
            return a.diff - b.diff;
        });
    } else {
        // 没有厨师：按最高技法值降序
        recipeOptions.sort(function(a, b) {
            if (a.isPlaceholder) return -1;
            if (b.isPlaceholder) return 1;
            return b.maxSkill - a.maxSkill;
        });
    }
    
    // 重新构建option列表
    $select.empty();
    for (var i = 0; i < recipeOptions.length; i++) {
        $select.append(recipeOptions[i].$opt);
    }
    
    // 恢复选中的值
    $select.val(currentValue);
}

/**
 * 计算厨师做菜谱能达到的品级
 * 返回：4=神, 3=特, 2=优, 1=可, 0=无法制作
 */
function calculateRecipeRank(chef, recipe) {
    var skills = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    var minRank = 4; // 从神级开始检查
    
    for (var i = 0; i < skills.length; i++) {
        var skill = skills[i];
        var recipeNeed = recipe[skill] || 0;
        if (recipeNeed > 0) {
            var chefVal = chef[skill + 'Val'] || 0;
            
            // 计算能达到的品级
            var rank = 0;
            if (chefVal >= recipeNeed * 4) {
                rank = 4; // 神级
            } else if (chefVal >= recipeNeed * 3) {
                rank = 3; // 特级
            } else if (chefVal >= recipeNeed * 2) {
                rank = 2; // 优级
            } else if (chefVal >= recipeNeed) {
                rank = 1; // 可级
            } else {
                rank = 0; // 无法制作
            }
            
            // 取所有技法中的最低品级
            if (rank < minRank) {
                minRank = rank;
            }
        }
    }
    
    return minRank;
}

/**
 * 获取厨师的第一个修炼任务（用于菜谱过滤）
 */
function getChefFirstUltimateQuestForCultivation(chefId) {
    
    // 从rule.chefs中获取厨师原始数据（包含ultimateGoal）
    var rule = calCustomRule.rules[0];
    if (!rule || !rule.chefs) {
        return null;
    }
    
    var originalChef = null;
    for (var i = 0; i < rule.chefs.length; i++) {
        if (rule.chefs[i].chefId === chefId || rule.chefs[i].chefId == chefId) {
            originalChef = rule.chefs[i];
            break;
        }
    }
    
    if (!originalChef) {
        return null;
    }
    
    
    if (!originalChef.ultimateGoal || originalChef.ultimateGoal.length === 0) {
        return null;
    }
    
    var questId = originalChef.ultimateGoal[0];
    
    // 使用保存的cultivationGameData获取quests
    if (!cultivationGameData || !cultivationGameData.quests) {
        return null;
    }
    
    
    for (var i = 0; i < cultivationGameData.quests.length; i++) {
        if (cultivationGameData.quests[i].questId === questId || cultivationGameData.quests[i].questId == questId) {
            if (cultivationGameData.quests[i].conditions) {
                return cultivationGameData.quests[i];
            }
        }
    }
    
    return null;
}

/**
 * 检查菜谱是否满足修炼任务条件（不检查品级rank）
 */
function checkRecipeMatchQuestConditionsWithoutRank(recipe, quest) {
    if (!quest || !quest.conditions || quest.conditions.length === 0) {
        return false;
    }
    
    var conditions = quest.conditions;
    var matched = false;
    
    for (var o in conditions) {
        var p = true;
        var r = conditions[o];
        
        // 检查指定菜谱ID
        if (r.recipeId && r.recipeId != recipe.recipeId) p = false;
        
        // 检查材料
        if (p && r.materialId) {
            var hasMaterial = false;
            for (var u in recipe.materials) {
                if (recipe.materials[u].material == r.materialId) {
                    hasMaterial = true;
                    break;
                }
            }
            if (!hasMaterial) p = false;
        }
        
        // 检查贵客
        if (p && r.guest) {
            if (recipe.guestsVal && recipe.guestsVal.indexOf(r.guest) >= 0) {
                // 匹配
            } else if (recipe.rankGuestsVal && recipe.rankGuestsVal.indexOf(r.guest) >= 0) {
                // 匹配
            } else {
                p = false;
            }
        }
        
        // 检查任意贵客或新贵客
        if (p && (r.anyGuest || r.newGuest)) {
            if (!recipe.guestsVal && !recipe.rankGuestsVal) p = false;
        }
        
        // 检查技法
        if (p && r.skill && recipe["" + r.skill] == 0) p = false;
        
        // 检查稀有度（星级）
        if (p && r.rarity && recipe.rarity < r.rarity) p = false;
        
        // 检查价格
        if (p && r.price && recipe.price < r.price) p = false;
        
        // 检查分类
        if (p && r.category && !recipe["" + r.category]) p = false;
        
        // 检查调料
        if (p && r.condiment && recipe.condiment != r.condiment) p = false;
        
        // 不检查品级要求 (rank)
        
        if (p) {
            matched = true;
            break;
        }
    }
    
    return matched;
}

/**
 * 获取神级推荐的厨具ID列表
 * 逻辑：
 * 1. 获取当前厨师的技法值（已包含厨具、光环加成）
 * 2. 获取已选菜谱，找出未达目标品级的菜谱
 * 3. 计算每种技法的最大差值
 * 4. 筛选能使菜谱达目标品级的厨具
/**
 * 计算菜谱的技法差值（根据查询品级动态计算）
 * @returns {object} { totalDeficit: 总差值, deficits: { stirfry: x, boil: y, ... } }
 */
function calculateRecipeSkillDeficit(chef, recipe) {
    var deficits = createEmptySkillBonus();
    var totalDeficit = 0;
    
    // 使用公共函数获取品级倍率
    var gradeMultiplier = getGradeMultiplier();
    
    var skillChecks = [
        { skill: 'stirfry', chefVal: chef.stirfryVal || 0, recipeVal: recipe.stirfry || 0 },
        { skill: 'boil', chefVal: chef.boilVal || 0, recipeVal: recipe.boil || 0 },
        { skill: 'knife', chefVal: chef.knifeVal || 0, recipeVal: recipe.knife || 0 },
        { skill: 'fry', chefVal: chef.fryVal || 0, recipeVal: recipe.fry || 0 },
        { skill: 'bake', chefVal: chef.bakeVal || 0, recipeVal: recipe.bake || 0 },
        { skill: 'steam', chefVal: chef.steamVal || 0, recipeVal: recipe.steam || 0 }
    ];
    
    for (var i = 0; i < skillChecks.length; i++) {
        var check = skillChecks[i];
        if (check.recipeVal > 0) {
            var required = check.recipeVal * gradeMultiplier;
            var deficit = required - check.chefVal;
            if (deficit > 0) {
                deficits[check.skill] = deficit;
                totalDeficit += deficit;
            }
        }
    }
    
    return { totalDeficit: totalDeficit, deficits: deficits };
}

/**
 * 计算厨具能使多少个菜谱达神（支持百分比加成厨具）
 * @param chefBase - 厨师基础数据（深拷贝用）
 * @param equip - 厨具数据
 * @param selectedRecipes - 已选菜谱数组
 * @param rule - 规则对象
 * @param chefIndex - 厨师位置索引
 * @param partialAdds - 光环加成
 * @returns {number} 能达神的菜谱数量
 */
function countEquipGodRecipesWithSetData(chefBase, equip, selectedRecipes, rule, chefIndex, partialAdds) {
    if (!equip || !selectedRecipes || selectedRecipes.length === 0) return 0;
    
    // 深拷贝厨师数据
    var chefCopy = JSON.parse(JSON.stringify(chefBase));
    
    // 使用setDataForChef计算包含厨具的技法值
    setDataForChef(
        chefCopy,
        equip,  // 使用指定厨具
        true,
        rule.calGlobalUltimateData,
        partialAdds,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        true,  // 使用遗玉
        rule.calQixiaData || null
    );
    
    var chefWithEquip = {
        stirfryVal: chefCopy.stirfryVal || 0,
        boilVal: chefCopy.boilVal || 0,
        knifeVal: chefCopy.knifeVal || 0,
        fryVal: chefCopy.fryVal || 0,
        bakeVal: chefCopy.bakeVal || 0,
        steamVal: chefCopy.steamVal || 0
    };
    
    // 计算能达神的菜谱数量
    var godCount = 0;
    for (var i = 0; i < selectedRecipes.length; i++) {
        var recipe = selectedRecipes[i];
        var skillDiff = calculateRecipeSkillDeficit(chefWithEquip, recipe);
        if (skillDiff.totalDeficit <= 0) {
            godCount++;
        }
    }
    
    return godCount;
}

/**
 * 获取厨具能提升为神级的菜谱名称列表（支持百分比加成厨具）
 */
function getEquipGodRecipeNamesWithSetData(chefBase, equip, selectedRecipes, rule, chefIndex, partialAdds) {
    if (!equip || !selectedRecipes || selectedRecipes.length === 0) return [];
    
    // 深拷贝厨师数据
    var chefCopy = JSON.parse(JSON.stringify(chefBase));
    
    // 使用setDataForChef计算包含厨具的技法值
    setDataForChef(
        chefCopy,
        equip,  // 使用指定厨具
        true,
        rule.calGlobalUltimateData,
        partialAdds,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        true,  // 使用遗玉
        rule.calQixiaData || null
    );
    
    var chefWithEquip = {
        stirfryVal: chefCopy.stirfryVal || 0,
        boilVal: chefCopy.boilVal || 0,
        knifeVal: chefCopy.knifeVal || 0,
        fryVal: chefCopy.fryVal || 0,
        bakeVal: chefCopy.bakeVal || 0,
        steamVal: chefCopy.steamVal || 0
    };
    
    // 获取能达神的菜谱名称
    var godRecipeNames = [];
    for (var i = 0; i < selectedRecipes.length; i++) {
        var recipe = selectedRecipes[i];
        var skillDiff = calculateRecipeSkillDeficit(chefWithEquip, recipe);
        if (skillDiff.totalDeficit <= 0 && recipe.name) {
            godRecipeNames.push(recipe.name);
        }
    }
    
    return godRecipeNames;
}

/**
 * 计算使用厨具后的总差值（支持百分比加成厨具）
 * @param chefBase - 厨师基础数据（深拷贝用）
 * @param equip - 厨具数据
 * @param selectedRecipes - 已选菜谱数组
 * @param rule - 规则对象
 * @param chefIndex - 厨师位置索引
 * @param partialAdds - 光环加成
 * @returns {object} { totalDeficit: 总差值, deficitDetail: "炒-83 炸-90" 格式的详细差值 }
 */
function calculateEquipTotalDeficit(chefBase, equip, selectedRecipes, rule, chefIndex, partialAdds) {
    if (!equip || !selectedRecipes || selectedRecipes.length === 0) return { totalDeficit: 9999, deficitDetail: '' };
    
    // 深拷贝厨师数据
    var chefCopy = JSON.parse(JSON.stringify(chefBase));
    
    // 使用setDataForChef计算包含厨具的技法值
    setDataForChef(
        chefCopy,
        equip,  // 使用指定厨具
        true,
        rule.calGlobalUltimateData,
        partialAdds,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        true,  // 使用遗玉
        rule.calQixiaData || null
    );
    
    var chefWithEquip = {
        stirfryVal: chefCopy.stirfryVal || 0,
        boilVal: chefCopy.boilVal || 0,
        knifeVal: chefCopy.knifeVal || 0,
        fryVal: chefCopy.fryVal || 0,
        bakeVal: chefCopy.bakeVal || 0,
        steamVal: chefCopy.steamVal || 0
    };
    
    // 计算所有菜谱需要的最大技法值（合并所有菜谱的需求）
    var maxDeficits = {};
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        maxDeficits[SKILL_TYPES[i]] = 0;
    }
    
    for (var i = 0; i < selectedRecipes.length; i++) {
        var recipe = selectedRecipes[i];
        var skillDiff = calculateRecipeSkillDeficit(chefWithEquip, recipe);
        // 取每种技法的最大差值
        for (var skill in skillDiff.deficits) {
            if (skillDiff.deficits[skill] > maxDeficits[skill]) {
                maxDeficits[skill] = skillDiff.deficits[skill];
            }
        }
    }
    
    // 计算总差值和详细差值字符串
    var totalDeficit = 0;
    var deficitParts = [];
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        var skill = SKILL_TYPES[i];
        if (maxDeficits[skill] > 0) {
            totalDeficit += maxDeficits[skill];
            deficitParts.push(SKILL_NAMES[skill] + '-' + maxDeficits[skill]);
        }
    }
    
    return {
        totalDeficit: totalDeficit,
        deficitDetail: deficitParts.join(' ')
    };
}

/**
 * 计算厨具能使多少个菜谱达神，并返回能达神的菜谱名称列表
 */
function countEquipGodRecipes(chefWithoutEquip, notGodRecipes, equipBonus) {
    var godCount = 0;
    
    for (var i = 0; i < notGodRecipes.length; i++) {
        var recipeData = notGodRecipes[i];
        var canGod = true;
        
        // 检查每种技法的差值是否能被厨具补上
        for (var skill in recipeData.deficits) {
            if (recipeData.deficits[skill] > 0) {
                // 厨具加成是否能补上这个差值
                if (equipBonus[skill] < recipeData.deficits[skill]) {
                    canGod = false;
                    break;
                }
            }
        }
        
        if (canGod) {
            godCount++;
        }
    }
    
    return godCount;
}

/**
 * 获取厨具能提升为神级的菜谱名称列表
 */
function getEquipGodRecipeNames(chefWithoutEquip, notGodRecipes, equipBonus) {
    var godRecipeNames = [];
    
    for (var i = 0; i < notGodRecipes.length; i++) {
        var recipeData = notGodRecipes[i];
        var canGod = true;
        
        // 检查每种技法的差值是否能被厨具补上
        for (var skill in recipeData.deficits) {
            if (recipeData.deficits[skill] > 0) {
                // 厨具加成是否能补上这个差值
                if (equipBonus[skill] < recipeData.deficits[skill]) {
                    canGod = false;
                    break;
                }
            }
        }
        
        if (canGod && recipeData.recipe && recipeData.recipe.name) {
            godRecipeNames.push(recipeData.recipe.name);
        }
    }
    
    return godRecipeNames;
}

/**
 * 获取指定厨具列表的可提升信息和差值信息（用于神级推荐分类显示）
 * 返回每个厨具的godRecipeNames（能达标的菜谱名）和totalDeficit（总差值）
 */
function getGodRecommendEquipInfoForAll($select, recommendedEquipIds) {
    
    if (!recommendedEquipIds || recommendedEquipIds.length === 0) return null;
    
    // 获取当前厨师位置
    var $selectedItem = $select.closest('.selected-item');
    var $calCustomItem = $select.closest('.cal-custom-item');
    var ruleIndex = $(".cal-custom-item").index($calCustomItem);
    var chefIndex = $calCustomItem.find(".selected-item").index($selectedItem);
    
    if (ruleIndex < 0 || chefIndex < 0) return null;
    
    var rule = calCustomRule.rules[ruleIndex];
    if (!rule || !rule.custom || !rule.custom[chefIndex]) return null;
    
    var customData = rule.custom[chefIndex];
    var chef = customData.chef;
    
    if (!chef || !chef.chefId) return null;
    
    // 获取已选菜谱
    var recipes = customData.recipes || [];
    var selectedRecipes = [];
    for (var i = 0; i < recipes.length; i++) {
        if (recipes[i] && recipes[i].data) {
            selectedRecipes.push(recipes[i].data);
        }
    }
    
    if (selectedRecipes.length === 0) return null;
    
    // 获取光环加成
    var partialAdds = null;
    try {
        var customArray = [];
        for (var ci = 0; ci < rule.custom.length; ci++) {
            customArray.push(rule.custom[ci]);
        }
        partialAdds = getPartialChefAdds(customArray, rule);
        partialAdds = partialAdds[chefIndex] || null;
    } catch (e) {
    }
    
    // 获取可用厨具列表
    var equips = rule.equips || [];
    
    // 创建厨具ID到厨具数据的映射
    var equipMap = {};
    for (var i = 0; i < equips.length; i++) {
        if (equips[i] && equips[i].equipId) {
            equipMap[String(equips[i].equipId)] = equips[i];
        }
    }
    
    // 计算每个厨具的信息
    var equipInfo = {};
    for (var i = 0; i < recommendedEquipIds.length; i++) {
        var equipId = String(recommendedEquipIds[i]);
        var equip = equipMap[equipId];
        if (!equip) continue;
        
        // 计算能达标的菜谱名称
        var godRecipeNames = getEquipGodRecipeNamesWithSetData(chef, equip, selectedRecipes, rule, chefIndex, partialAdds);
        
        // 计算总差值和详细差值
        var deficitResult = calculateEquipTotalDeficit(chef, equip, selectedRecipes, rule, chefIndex, partialAdds);
        
        equipInfo[equipId] = {
            godRecipeNames: godRecipeNames,
            totalDeficit: deficitResult.totalDeficit,
            deficitDetail: deficitResult.deficitDetail
        };
    }
    
    return equipInfo;
}
/**
 * 修炼模式下对厨具选项进行排序
 * 排序优先级：能补更多菜谱的优先 > 来源优先级 > 厨具ID降序
 * @param options - getCustomEquipsOptions返回的选项数组
 * @param ruleIndex - 规则索引
 * @param chefIndex - 厨师位置索引
 * @param equips - 厨具数据数组
 * @returns 排序后的选项数组
 */
function sortEquipsForCultivation(options, ruleIndex, chefIndex, equips) {
    
    var rule = calCustomRule.rules[ruleIndex];
    if (!rule || !rule.custom || !rule.custom[chefIndex]) {
        return options;
    }
    
    var customData = rule.custom[chefIndex];
    var chef = customData.chef;
    
    // 如果没有选择厨师，返回原选项
    if (!chef || !chef.chefId) {
        return options;
    }
    
    // 获取已选菜谱
    var recipes = customData.recipes || [];
    var selectedRecipes = [];
    for (var i = 0; i < recipes.length; i++) {
        if (recipes[i] && recipes[i].data) {
            selectedRecipes.push(recipes[i].data);
        }
    }
    
    // 如果没有选择菜谱，返回原选项
    if (selectedRecipes.length === 0) {
        return options;
    }
    
    // 计算不含当前厨具的厨师技法值（使用setDataForChef重新计算，以正确处理百分比加成）
    var currentEquip = customData.equip;
    
    // 深拷贝厨师数据，使用setDataForChef重新计算不含厨具的技法值
    var chefCopyForCalc = JSON.parse(JSON.stringify(chef));
    // 获取光环加成（使用公共函数）
    var partialAdds = getPartialAddsForChef(rule, chefIndex);
    
    // 调用setDataForChef计算不含厨具的技法值
    setDataForChef(
        chefCopyForCalc,
        null,  // 不使用厨具
        true,
        rule.calGlobalUltimateData,
        partialAdds,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        true,  // 使用遗玉
        rule.calQixiaData || null
    );
    
    var chefWithoutEquip = {
        stirfryVal: chefCopyForCalc.stirfryVal || 0,
        boilVal: chefCopyForCalc.boilVal || 0,
        knifeVal: chefCopyForCalc.knifeVal || 0,
        fryVal: chefCopyForCalc.fryVal || 0,
        bakeVal: chefCopyForCalc.bakeVal || 0,
        steamVal: chefCopyForCalc.steamVal || 0
    };
    
    
    // 找出未达神的菜谱，并计算每种技法的最大神差值
    var notGodRecipes = [];
    var maxSkillDeficits = createEmptySkillBonus(); // 每种技法的最大神差值
    
    for (var i = 0; i < selectedRecipes.length; i++) {
        var recipe = selectedRecipes[i];
        var skillDiff = calculateRecipeSkillDeficit(chefWithoutEquip, recipe);
        if (skillDiff.totalDeficit > 0) {
            notGodRecipes.push({
                recipe: recipe,
                deficits: skillDiff.deficits
            });
            // 更新每种技法的最大神差值
            for (var skill in skillDiff.deficits) {
                if (skillDiff.deficits[skill] > maxSkillDeficits[skill]) {
                    maxSkillDeficits[skill] = skillDiff.deficits[skill];
                }
            }
        }
    }
    
    
    // 如果所有菜谱都已达神，返回原选项
    if (notGodRecipes.length === 0) {
        return options;
    }
    
    // 创建厨具ID到厨具数据的映射
    var equipMap = {};
    for (var i = 0; i < equips.length; i++) {
        if (equips[i] && equips[i].equipId) {
            equipMap[equips[i].equipId] = equips[i];
        }
    }
    
    // 获取未达神的菜谱数据（用于新函数）
    var notGodRecipeData = [];
    for (var i = 0; i < notGodRecipes.length; i++) {
        notGodRecipeData.push(notGodRecipes[i].recipe);
    }
    
    // 为每个选项计算能补的菜谱数量和来源优先级
    var enrichedOptions = [];
    for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        var equipId = opt.value;
        var equip = equipMap[equipId];
        
        // 无厨具选项保持在最前面
        if (!equipId || equipId === "") {
            enrichedOptions.push({
                option: opt,
                godCount: -1, // 特殊值，保持在最前
                originPriority: 0,
                equipId: 0
            });
            continue;
        }
        
        if (!equip) {
            enrichedOptions.push({
                option: opt,
                godCount: 0,
                originPriority: 4,
                equipId: Number(equipId) || 0
            });
            continue;
        }
        
        // 使用新函数计算厨具效果（支持百分比加成）
        var godCount = countEquipGodRecipesWithSetData(chef, equip, notGodRecipeData, rule, chefIndex, partialAdds);
        var originPriority = getEquipOriginPriority(equip.origin);
        
        if (godCount > 0) {
        }
        
        enrichedOptions.push({
            option: opt,
            godCount: godCount,
            originPriority: originPriority,
            equipId: equip.equipId || 0
        });
    }
    
    // 检查是否有能使菜谱达神的厨具
    var hasRecommended = false;
    for (var i = 0; i < enrichedOptions.length; i++) {
        if (enrichedOptions[i].godCount > 0) {
            hasRecommended = true;
            break;
        }
    }
    
    // 如果没有能使菜谱达神的厨具，计算每个厨具的总差值
    if (!hasRecommended) {
        
        // 为每个厨具计算总差值
        for (var i = 0; i < enrichedOptions.length; i++) {
            var opt = enrichedOptions[i];
            if (opt.godCount === -1) continue; // 跳过无厨具选项
            
            var equipId = opt.option.value;
            var equip = equipMap[equipId];
            if (!equip) {
                opt.totalDeficit = 9999;
                opt.deficitDetail = '';
                continue;
            }
            
            // 计算使用该厨具后的总差值和详细差值
            var deficitResult = calculateEquipTotalDeficit(chef, equip, notGodRecipeData, rule, chefIndex, partialAdds);
            opt.totalDeficit = deficitResult.totalDeficit;
            opt.deficitDetail = deficitResult.deficitDetail;
            
            if (deficitResult.totalDeficit <= 300) {
            }
        }
        
        // 按总差值升序排序
        enrichedOptions.sort(function(a, b) {
            // 无厨具选项排到最后
            if (a.godCount === -1) return 1;
            if (b.godCount === -1) return 1;
            
            // 按总差值升序
            return (a.totalDeficit || 9999) - (b.totalDeficit || 9999);
        });
        
        // 只返回总差值300以内的厨具（不包含无厨具选项）
        var result = [];
        for (var i = 0; i < enrichedOptions.length; i++) {
            if (enrichedOptions[i].godCount === -1) continue; // 跳过无厨具选项
            if ((enrichedOptions[i].totalDeficit || 9999) <= 300) {
                result.push(enrichedOptions[i].option);
            }
        }
        
        return result;
    }
    
    // 排序：能补更多菜谱的优先 > 来源优先级 > 厨具ID降序
    enrichedOptions.sort(function(a, b) {
        // 无厨具选项保持在最前
        if (a.godCount === -1) return -1;
        if (b.godCount === -1) return 1;
        
        // 1. 能补更多菜谱的优先
        if (b.godCount !== a.godCount) {
            return b.godCount - a.godCount;
        }
        // 2. 来源优先级（数字越小越优先）
        if (a.originPriority !== b.originPriority) {
            return a.originPriority - b.originPriority;
        }
        // 3. 同来源按厨具ID降序（新厨具优先）
        return b.equipId - a.equipId;
    });
    
    // 只返回能使菜谱达神的厨具（godCount > 0），不包含无厨具选项
    var result = [];
    var currentEquipId = customData.equip && customData.equip.equipId ? String(customData.equip.equipId) : null;
    var currentEquipInResult = false;
    
    for (var i = 0; i < enrichedOptions.length; i++) {
        if (enrichedOptions[i].godCount > 0) {
            result.push(enrichedOptions[i].option);
            // 检查当前选中的厨具是否在结果中
            if (currentEquipId && String(enrichedOptions[i].option.value) === currentEquipId) {
                currentEquipInResult = true;
            }
        }
    }
    
    // 如果当前选中的厨具不在结果中，添加它（确保用户能看到自己选择的厨具）
    if (currentEquipId && !currentEquipInResult) {
        for (var i = 0; i < options.length; i++) {
            if (String(options[i].value) === currentEquipId) {
                result.push(options[i]);
                break;
            }
        }
    }
    
    
    return result;
}

/**
 * 根据分类过滤厨师列表（修改option元素，然后刷新selectpicker）
 * @param isGodMode - 是否为神级方案模式
 */
function filterCultivationChefs($select, selectId, categoryName, isGodMode) {
    var sp = $select.data('selectpicker');
    if (!sp) return;
    
    // 保存当前选中的值
    var currentValue = $select.val();
    
    // 获取当前厨师位置信息，用于从 calCustomRule 获取真正选中的厨师ID
    var $selectedItem = $select.closest('.selected-item');
    var $calCustomItem = $select.closest('.cal-custom-item');
    var ruleIndex = $(".cal-custom-item").index($calCustomItem);
    var chefIndex = $calCustomItem.find(".selected-item").index($selectedItem);
    
    // 从 calCustomRule 获取真正选中的厨师ID（比 $select.val() 更可靠）
    var realSelectedChefId = null;
    if (calCustomRule && calCustomRule.rules && calCustomRule.rules[ruleIndex] && 
        calCustomRule.rules[ruleIndex].custom && calCustomRule.rules[ruleIndex].custom[chefIndex] &&
        calCustomRule.rules[ruleIndex].custom[chefIndex].chef) {
        realSelectedChefId = calCustomRule.rules[ruleIndex].custom[chefIndex].chef.chefId;
        if (realSelectedChefId) {
            realSelectedChefId = String(realSelectedChefId);
        }
    }
    
    // 保存当前的搜索关键词
    var $searchInput = sp.$menu.find('.bs-searchbox input');
    var searchKeyword = $searchInput.length ? $searchInput.val() : '';
    
    // 恢复原始的option列表
    var originalHtml = cultivationOriginalOptionsHtml[selectId];
    if (originalHtml) {
        $select.html(originalHtml);
    }
    
    // 获取品级信息（使用公共函数）
    var gradeMultiplier = getGradeMultiplier();
    var gradeName = getGradeNameShort();
    
    // 神级推荐分类特殊处理
    if (categoryName === 'god-recommend-chef-category' && isGodMode) {
        // 获取当前厨师位置信息（已在函数开头获取）
        // 获取已选菜谱
        var rule = calCustomRule.rules[ruleIndex];
        var selectedRecipes = [];
        if (rule && rule.custom && rule.custom[chefIndex]) {
            var recipes = rule.custom[chefIndex].recipes || [];
            for (var i = 0; i < recipes.length; i++) {
                if (recipes[i] && recipes[i].data) {
                    selectedRecipes.push(recipes[i].data);
                }
            }
        }
        
        // 收集所有厨师选项及其技法差值
        var chefOptions = [];
        $select.find('option').each(function() {
            var $opt = $(this);
            var chefId = $opt.val();
            
            // 保留占位项
            if (chefId === "" || chefId === null || $opt.text().trim() === "") {
                chefOptions.push({ $opt: $opt, isPlaceholder: true, skillDiff: 0, skillDiffDetail: null });
                return;
            }
            
            // 计算该厨师对已选菜谱的技法差值总和
            var skillDiff = 0;
            var skillDiffDetail = null;
            if (selectedRecipes.length > 0 && rule && rule.chefs) {
                // 找到厨师数据
                var chefData = null;
                for (var i = 0; i < rule.chefs.length; i++) {
                    if (String(rule.chefs[i].chefId) === String(chefId)) {
                        chefData = rule.chefs[i];
                        break;
                    }
                }
                
                if (chefData) {
                    // 计算对所有已选菜谱的技法差值总和，并获取详细差值（传入rule和chefIndex以支持厨具/遗玉/光环加成计算）
                    skillDiffDetail = calculateSkillDiffDetailForGodRecommend(chefData, selectedRecipes, gradeMultiplier, rule, chefIndex);
                    skillDiff = skillDiffDetail.totalDiff;
                }
            }
            
            chefOptions.push({ $opt: $opt, isPlaceholder: false, skillDiff: skillDiff, skillDiffDetail: skillDiffDetail, chefId: chefId });
        });
        
        // 按技法差值升序排序（差值小的优先）
        chefOptions.sort(function(a, b) {
            if (a.isPlaceholder) return -1;
            if (b.isPlaceholder) return 1;
            return a.skillDiff - b.skillDiff;
        });
        
        // 重新构建option列表，并为有差值的厨师添加差值信息
        $select.empty();
        for (var i = 0; i < chefOptions.length; i++) {
            var opt = chefOptions[i];
            if (!opt.isPlaceholder && opt.skillDiff > 0 && opt.skillDiffDetail) {
                // 添加差值信息到选项内容（插入到星级后面）
                var currentContent = opt.$opt.attr('data-content') || opt.$opt.text();
                var diffInfo = '<span style="color:#dc3545;font-size:11px;margin-left:5px;">' + gradeName + '差值:' + opt.skillDiffDetail.disp + '</span>';
                
                // 查找星级span（class='subtext'的第一个span），在其后插入差值信息
                // 星级格式：<span class='subtext'>★★★★★</span>
                var subtextMatch = currentContent.match(/<span class=['"]subtext['"]>[^<]*<\/span>/);
                if (subtextMatch) {
                    // 找到星级span，在其后插入差值信息
                    var subtextEndIndex = currentContent.indexOf(subtextMatch[0]) + subtextMatch[0].length;
                    currentContent = currentContent.substring(0, subtextEndIndex) + diffInfo + currentContent.substring(subtextEndIndex);
                } else {
                    // 没找到星级span，在厨师名后面插入
                    var nameEndIndex = currentContent.indexOf("</span>");
                    if (nameEndIndex > 0) {
                        currentContent = currentContent.substring(0, nameEndIndex + 7) + diffInfo + currentContent.substring(nameEndIndex + 7);
                    } else {
                        currentContent += diffInfo;
                    }
                }
                opt.$opt.attr('data-content', currentContent);
            }
            $select.append(opt.$opt);
        }
    } else if (categoryName === 'aura-chef-category') {
        // 光环厨师分类：按技法类型分组，支持折叠
        // 1. Next类厨师优先（单独分组）
        // 2. 相同技法类型的厨师在一起
        // 3. 按加成值降序排序
        
        // 位置信息和 realSelectedChefId 已在函数开头获取
        
        var rule = calCustomRule.rules[ruleIndex]; // 获取规则
        var auraChefsByGroup = {
            'Next': [],
            'Stirfry': [],
            'Boil': [],
            'Knife': [],
            'Fry': [],
            'Bake': [],
            'Steam': []
        };
        var placeholderOpt = null;
        
        // 技法类型中文名
        var skillTypeNames = {
            'Next': '全技法',
            'Stirfry': '炒技法',
            'Boil': '煮技法',
            'Knife': '切技法',
            'Fry': '炸技法',
            'Bake': '烤技法',
            'Steam': '蒸技法'
        };
        
        $select.find('option').each(function() {
            var $opt = $(this);
            var cat = $opt.attr('data-category') || '';
            var chefId = $opt.val();
            
            // 保留占位项
            if (chefId === "" || chefId === null || $opt.text().trim() === "") {
                placeholderOpt = $opt;
                return;
            }
            
            // 检查是否匹配光环分类
            if (cat.indexOf('aura-chef-category') < 0) {
                return; // 不是光环厨师，跳过
            }
            
            // 获取厨师数据
            var chefData = null;
            if (rule && rule.chefs) {
                for (var i = 0; i < rule.chefs.length; i++) {
                    if (String(rule.chefs[i].chefId) === String(chefId)) {
                        chefData = rule.chefs[i];
                        break;
                    }
                }
            }
            
            // 解析光环效果
            var isNext = false;
            var primarySkillType = '';
            var totalBonus = 0;
            
            if (chefData && chefData.ultimateSkillEffect) {
                for (var k = 0; k < chefData.ultimateSkillEffect.length; k++) {
                    var effect = chefData.ultimateSkillEffect[k];
                    var isSkillType = effect.type === "Stirfry" || effect.type === "Boil" || 
                                      effect.type === "Knife" || effect.type === "Fry" || 
                                      effect.type === "Bake" || effect.type === "Steam";
                    
                    if ((effect.condition === "Next" || effect.condition === "Partial") && isSkillType) {
                        if (effect.condition === "Next") {
                            isNext = true;
                        }
                        
                        // 记录技法类型和加成值
                        var bonus = effect.value || 0;
                        if (effect.cal === "Percent") {
                            bonus = bonus * 10; // 百分比加成权重更高
                        }
                        totalBonus += bonus;
                        
                        // 记录主要技法类型（第一个遇到的）
                        if (!primarySkillType) {
                            primarySkillType = effect.type;
                        }
                    }
                }
            }
            
            var chefInfo = {
                $opt: $opt,
                isNext: isNext,
                skillType: primarySkillType,
                totalBonus: totalBonus
            };
            
            // 分组：Next类单独分组，其他按技法类型分组
            if (isNext) {
                auraChefsByGroup['Next'].push(chefInfo);
            } else if (primarySkillType && auraChefsByGroup[primarySkillType]) {
                auraChefsByGroup[primarySkillType].push(chefInfo);
            }
        });
        
        // 每组内按加成值降序排序
        for (var groupKey in auraChefsByGroup) {
            auraChefsByGroup[groupKey].sort(function(a, b) {
                return b.totalBonus - a.totalBonus;
            });
        }
        
        // 重新构建option列表，使用optgroup分组
        $select.empty();
        
        // 添加占位项
        if (placeholderOpt) {
            $select.append(placeholderOpt);
        }
        
        // 按顺序添加分组
        var groupOrder = ['Next', 'Stirfry', 'Boil', 'Knife', 'Fry', 'Bake', 'Steam'];
        for (var g = 0; g < groupOrder.length; g++) {
            var groupKey = groupOrder[g];
            var groupChefs = auraChefsByGroup[groupKey];
            
            if (groupChefs.length > 0) {
                // 创建optgroup
                var $optgroup = $('<optgroup label="' + skillTypeNames[groupKey] + ' (' + groupChefs.length + ')"></optgroup>');
                
                for (var c = 0; c < groupChefs.length; c++) {
                    $optgroup.append(groupChefs[c].$opt);
                }
                
                $select.append($optgroup);
            }
        }
        
        // 刷新selectpicker后添加折叠功能
        sp.refresh();
        
        // 修复 bootstrap-select 的 bug：使用 optgroup 时，最后一个分组的最后一个选项会被错误地标记为 selected/disabled
        // 注意：不能清除所有 disabled 类，因为已选择的厨师需要保持 disabled 状态
        
        // 修复 DOM 中的样式
        if (sp.$menu) {
            var $innerMenu = sp.$menu.find('.dropdown-menu.inner');
            if ($innerMenu.length) {
                // 使用从 calCustomRule 获取的真正选中的厨师ID（比 currentValue 更可靠）
                var realSelectedValue = realSelectedChefId;
                
                // 找到最后一个选项元素
                var $lastItem = $innerMenu.find('li a.dropdown-item').last().parent();
                
                if ($lastItem.length) {
                    // 获取最后一个选项的值
                    var lastOptionValue = null;
                    if (sp.selectpicker && sp.selectpicker.current && sp.selectpicker.current.data) {
                        var dataArray = sp.selectpicker.current.data;
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
                                    if (dataArray[i].type === 'option' && dataArray[i].option && String(dataArray[i].option.value) === String(lastOptionValue)) {
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
                                if (dataArray[i].type === 'option' && dataArray[i].option) {
                                    if (dataArray[i].option.value === realSelectedValue || String(dataArray[i].option.value) === String(realSelectedValue)) {
                                        dataArray[i].selected = true;
                                        // 设置 <option> 元素的 selected 属性
                                        dataArray[i].option.selected = true;
                                        
                                        // dataArray 的索引直接对应 li 元素的索引
                                        var $targetLi = $allLis.eq(i);
                                        if ($targetLi.length) {
                                            // 添加 selected 和 active 类来显示已选中状态（背景置灰）
                                            $targetLi.addClass('selected active');
                                            $targetLi.find('a').addClass('selected');
                                            // 当前选择框选中的厨师不应该是 disabled 状态，而是 selected 状态
                                            // 移除 disabled 类，确保显示为"已选择"而不是"不可选"
                                            $targetLi.removeClass('disabled');
                                            $targetLi.find('a').removeClass('disabled');
                                            
                                            // 同时移除 <option> 元素的 disabled 属性（针对当前选择框选中的厨师）
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
        
        // 添加折叠功能
        setTimeout(function() {
            addAuraChefCollapseFeature(sp.$menu);
        }, 10);
        
        // 恢复选中的值（使用 realSelectedChefId）
        if (realSelectedChefId) {
            $select.val(realSelectedChefId);
        }
        
        // 重新应用搜索关键词（如果有）
        if (searchKeyword) {
            setTimeout(function() {
                var $newSearchInput = sp.$menu.find('.bs-searchbox input');
                if ($newSearchInput.length) {
                    $newSearchInput.val(searchKeyword);
                    $newSearchInput.trigger('input');
                }
            }, 50);
        }
        
        return; // 提前返回，避免重复刷新
    } else if (categoryName) {
        // 其他分类：按原有逻辑过滤
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
    
    // 恢复选中的值（使用 realSelectedChefId）
    if (realSelectedChefId) {
        $select.val(realSelectedChefId);
    } else {
        $select.val(currentValue);
    }
    
    // 刷新selectpicker
    sp.refresh();
    
    // 修复 bootstrap-select 的 bug：sp.refresh() 后可能错误地标记选项状态
    // 为当前选择框选中的厨师添加正确的 selected 标记，移除 disabled 标记
    if (sp.$menu && realSelectedChefId) {
        var $innerMenu = sp.$menu.find('.dropdown-menu.inner');
        if ($innerMenu.length) {
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
                
                // 第三步：为真正选中的厨师添加正确的标记
                var $allLis = $innerMenu.find('li');
                for (var i = 0; i < dataArray.length; i++) {
                    if (dataArray[i].type === 'option' && dataArray[i].option) {
                        if (String(dataArray[i].option.value) === String(realSelectedChefId)) {
                            dataArray[i].selected = true;
                            
                            // dataArray 的索引直接对应 li 元素的索引
                            var $targetLi = $allLis.eq(i);
                            if ($targetLi.length) {
                                // 添加 selected 和 active 类来显示已选中状态（背景置灰）
                                $targetLi.addClass('selected active');
                                $targetLi.find('a').addClass('selected');
                                // 当前选择框选中的厨师不应该是 disabled 状态，而是 selected 状态
                                $targetLi.removeClass('disabled');
                                $targetLi.find('a').removeClass('disabled');
                                
                                // 同时移除 <option> 元素的 disabled 属性
                                var $selectedOption = $select.find('option[value="' + realSelectedChefId + '"]');
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
    
    // 重新应用搜索关键词（如果有）
    if (searchKeyword) {
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

// ==================== 初始化和配置 ====================

// 保存gameData的全局引用，供其他函数使用
var cultivationGameData = null;

/**
 * 初始化未修炼厨师下拉框功能
 * 注意：显示/隐藏逻辑已在 loadCalRule 中处理，这里只负责初始化数据和事件
 */
function initUnultimatedChefDropdown(gameData) {
    // 保存gameData到全局变量
    cultivationGameData = gameData;
    
    // 只在修炼查询模式下初始化
    var isCultivateMode = calCustomRule && calCustomRule.isCultivate === true;
    
    if (!isCultivateMode) {
        // 非修炼查询模式，不需要初始化
        return;
    }
    
    // 刷新未修炼厨师列表
    refreshUnultimatedChefList(gameData);
    
    // 初始化配置开关状态（从本地存储读取）
    initUnultimatedConfig();
    
    // 初始化查询按钮事件
    initUnultimatedQueryButton(gameData);
    
    // 弹窗显示时移除配置按钮焦点
    $("#unultimated-config-modal").off("shown.bs.modal").on("shown.bs.modal", function() {
        $("#btn-unultimated-config").blur();
    });
}

/**
 * 初始化厨师修炼查询配置
 */
function initUnultimatedConfig() {
    var localData = getLocalData();
    var config = localData.unultimatedConfig || {};
    
    // 设置开关状态
    if (config.useStrongEquip) {
        $("#chk-unultimated-use-strong-equip").bootstrapToggle("on");
    } else {
        $("#chk-unultimated-use-strong-equip").bootstrapToggle("off");
    }
    
    if (config.useNoRecipe) {
        $("#chk-unultimated-use-no-recipe").bootstrapToggle("on");
    } else {
        $("#chk-unultimated-use-no-recipe").bootstrapToggle("off");
    }
    
    // 监听开关变化，保存到本地存储
    $("#chk-unultimated-use-strong-equip").off("change").on("change", function() {
        saveUnultimatedConfig();
    });
    
    $("#chk-unultimated-use-no-recipe").off("change").on("change", function() {
        saveUnultimatedConfig();
    });
}

/**
 * 保存厨师修炼查询配置
 */
function saveUnultimatedConfig() {
    var config = {
        useStrongEquip: $("#chk-unultimated-use-strong-equip").prop("checked"),
        useNoRecipe: $("#chk-unultimated-use-no-recipe").prop("checked")
    };
    updateLocalData("unultimatedConfig", config);
}

/**
 * 刷新未修炼厨师列表
 */
function refreshUnultimatedChefList(gameData) {
    var rule = calCustomRule.rules[0];
    if (!rule || !rule.chefs) return;
    
    var localData = getLocalData();
    var configIds = getConfigUltimatedChefIds();
    var gotChecked = $("#chk-cal-got").prop("checked");
    
    // 获取当前已选中的厨师ID（转为字符串Set便于查找）
    var selectedIds = $("#select-cal-unultimated-chef").val() || [];
    var selectedSet = {};
    for (var s = 0; s < selectedIds.length; s++) {
        selectedSet[String(selectedIds[s])] = true;
    }
    
    var list = [];
    var validSelectedIds = []; // 过滤后仍然有效的已选ID
    
    for (var i = 0; i < rule.chefs.length; i++) {
        var chef = rule.chefs[i];
        
        if (chef.chefId == 285) continue;
        
        // 勾选已有，只显示已有且未修炼的厨师
        if (gotChecked) {
            var isOwned = chef.got || (configIds.allSet && configIds.allSet[String(chef.chefId)]);
            if (!isOwned) continue;
            // 跳过已修炼的
            if (isChefUltimated(chef.chefId, localData, configIds)) continue;
        }
        
        // 标记是否已选中
        var isSelected = selectedSet[String(chef.chefId)] === true;
        chef._isSelected = isSelected;
        if (isSelected) {
            validSelectedIds.push(String(chef.chefId));
        }
        list.push(chef);
    }
    
    // 排序：已选中的优先，然后按星级降序
    list.sort(function(a, b) {
        if (a._isSelected !== b._isSelected) {
            return a._isSelected ? -1 : 1;
        }
        return b.rarity - a.rarity;
    });
    
    // 生成选项，使用data-content显示厨师名、星级、修炼任务和修炼技能（换行显示）
    var html = '';
    for (var j = 0; j < list.length; j++) {
        var questDesc = '';
        if (list[j].ultimateGoal && list[j].ultimateGoal.length > 0 && cultivationGameData && cultivationGameData.quests) {
            var questId = list[j].ultimateGoal[0];
            for (var q = 0; q < cultivationGameData.quests.length; q++) {
                if (cultivationGameData.quests[q].questId === questId) {
                    questDesc = cultivationGameData.quests[q].goal || '';
                    break;
                }
            }
        }
        // 获取修炼技能描述
        var skillDesc = list[j].ultimateSkillDisp ? list[j].ultimateSkillDisp.replace(/<br>/g, ' ') : '';
        
        var contentHtml = '<div style="line-height:1.3;padding:5px 0;border-bottom:1px solid #eee;">' +
                          '<span class="name">' + list[j].name + '</span>' +
                          '<span class="subtext" style="margin-left:5px;">' + list[j].rarityDisp + '</span>';
        if (questDesc) {
            contentHtml += '<br><span style="color:#888;font-size:11px;">' + questDesc + '</span>';
        }
        if (skillDesc) {
            contentHtml += '<br><span style="color:#337ab7;font-size:11px;">' + skillDesc + '</span>';
        }
        contentHtml += '</div>';
        html += '<option value="' + list[j].chefId + '" data-content="' + contentHtml.replace(/"/g, '&quot;') + '" data-tokens="' + list[j].name + '">' + list[j].name + '</option>';
    }
    
    $("#select-cal-unultimated-chef").html(html).selectpicker("destroy").selectpicker({
        selectedTextFormat: 'count',
        countSelectedText: '{0}个厨师'
    });
    
    // 恢复选中状态（只恢复过滤后仍有效的）
    if (validSelectedIds.length > 0) {
        $("#select-cal-unultimated-chef").selectpicker('val', validSelectedIds);
    }
    
    // 在下拉框内添加清空按钮
    addClearButtonToUnultimatedDropdown();
    
    // 重新绑定选择变化事件（selectpicker destroy后需要重新绑定）
    $("#select-cal-unultimated-chef").off("changed.bs.select").on("changed.bs.select", function() {
        refreshUnultimatedChefSort();
    });
}

/**
 * 在未修炼厨师下拉框内添加清空按钮
 */
function addClearButtonToUnultimatedDropdown() {
    var $dropdown = $("#select-cal-unultimated-chef").closest(".bootstrap-select").find(".dropdown-menu");
    
    // 如果已经有清空按钮，先移除
    $dropdown.find(".unultimated-clear-btn").remove();
    
    // 在搜索框后面添加清空按钮
    var $searchBox = $dropdown.find(".bs-searchbox");
    if ($searchBox.length) {
        var clearBtn = '<div class="unultimated-clear-btn" style="padding: 3px 8px; border-bottom: 1px solid #ddd;">' +
            '<button type="button" class="btn btn-default btn-xs btn-block" style="font-size: 12px;">清空已选</button>' +
            '</div>';
        $searchBox.after(clearBtn);
        
        // 绑定点击事件
        $dropdown.find(".unultimated-clear-btn button").off("click").on("click", function(e) {
            e.stopPropagation();  // 阻止事件冒泡，防止关闭下拉框
            $("#select-cal-unultimated-chef").selectpicker('deselectAll');
            refreshUnultimatedChefSort();
        });
    }
}

/**
 * 刷新未修炼厨师下拉框排序（已选中的优先显示）
 */
var isRefreshingUnultimatedChefSort = false;
function refreshUnultimatedChefSort() {
    if (isRefreshingUnultimatedChefSort) return;
    isRefreshingUnultimatedChefSort = true;
    
    try {
        var $select = $("#select-cal-unultimated-chef");
        var selectedValues = $select.val() || [];
        var selectedSet = {};
        for (var s = 0; s < selectedValues.length; s++) {
            selectedSet[String(selectedValues[s])] = true;
        }
        
        // 获取所有选项
        var options = [];
        $select.find('option').each(function() {
            var $opt = $(this);
            options.push({
                value: $opt.val(),
                text: $opt.text(),
                content: $opt.attr('data-content') || '',
                isSelected: selectedSet[String($opt.val())] === true
            });
        });
        
        // 排序：已选中的优先
        options.sort(function(a, b) {
            if (a.isSelected !== b.isSelected) {
                return a.isSelected ? -1 : 1;
            }
            return 0; // 保持原有顺序
        });
        
        // 清空并重新添加选项
        $select.empty();
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            $select.append('<option value="' + opt.value + '" data-content="' + opt.content.replace(/"/g, '&quot;') + '">' + opt.text + '</option>');
        }
        
        // 刷新selectpicker并恢复选中状态
        $select.selectpicker('refresh');
        if (selectedValues.length > 0) {
            $select.selectpicker('val', selectedValues);
        }
    } finally {
        isRefreshingUnultimatedChefSort = false;
    }
}

// ==================== 主查询函数 ====================

/**
 * 初始化查询按钮事件
 */
function initUnultimatedQueryButton(gameData) {
    $("#btn-unultimated-query").off("click").on("click", function() {
        queryUnultimatedChefs(gameData);
    });
    
    // 选择变化时刷新排序（已选中的优先显示）
    $("#select-cal-unultimated-chef").off("changed.bs.select").on("changed.bs.select", function() {
        refreshUnultimatedChefSort();
    });
}

/**
 * 未修炼厨师修炼任务查询主函数
 */
function queryUnultimatedChefs(gameData) {
    var selectedChefIds = $("#select-cal-unultimated-chef").val();
    if (!selectedChefIds || selectedChefIds.length === 0) {
        return;
    }
    
    // 先清空场上已选
    clearAllSelectedOnField(gameData);
    
    // 1. 获取已勾选的上场类厨师，并分类
    var auraChefs = getEnabledAuraChefsForQuery(gameData);
    
    // 2. 获取选中的未修炼厨师数据
    var targetChefs = [];
    var rule = calCustomRule.rules[0];
    if (!rule || !rule.chefs) {
        return;
    }
    
    // 检查是否勾选了"已配厨具"
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    
    for (var i = 0; i < selectedChefIds.length; i++) {
        var chefId = Number(selectedChefIds[i]);
        var chef = null;
        for (var j = 0; j < rule.chefs.length; j++) {
            if (rule.chefs[j].chefId === chefId) {
                chef = JSON.parse(JSON.stringify(rule.chefs[j])); // 深拷贝，避免修改原数据
                break;
            }
        }
        if (chef) {
            // 保存原始厨具信息
            var originalEquip = chef.equip ? JSON.parse(JSON.stringify(chef.equip)) : null;
            
            // rule.chefs 中的数据是原始数据，不包含厨具加成
            // 需要调用 setDataForChef 来计算包含厨具的技法值
            var equipToUse = useEquip ? chef.equip : null;
            var partialAdds = null; // 暂不考虑光环加成
            
            // 调用 setDataForChef 计算技法值
            setDataForChef(
                chef,                           // 厨师
                equipToUse,                     // 厨具（如果勾选了已配厨具）
                true,                           // 是否计算
                rule.calGlobalUltimateData,     // 全局修炼数据
                partialAdds,                    // 光环加成
                rule.calSelfUltimateData,       // 自身修炼数据
                rule.calActivityUltimateData,   // 活动修炼数据
                true,                           // 是否使用修炼
                rule,                           // 规则
                true,                           // 是否使用遗玉
                rule.calQixiaData || null       // 奇侠数据
            );
            
            var quest = getChefFirstUltimateQuestForQuery(chef, gameData);
            targetChefs.push({
                chef: chef,
                quest: quest,
                originalEquip: originalEquip
            });
        }
    }
    
    if (targetChefs.length === 0) {
        alert("未找到选中的厨师数据");
        return;
    }
    
    // 3. 使用统一策略函数
    var result = queryUnifiedStrategy(gameData, targetChefs, auraChefs);
    
    // 4. 填充结果到UI
    if (result && result.success) {
        fillQueryResultToCalUI(result, gameData);
    } else {
        alert(result ? result.message : "查询失败");
    }
}

// ==================== 光环厨师处理 ====================

/**
 * 从计算器配置页面获取已勾选的上场类厨师，并分类
 * 获取NEXT类和Partial技法加成类厨师
 */
function getEnabledAuraChefsForQuery(gameData) {
    var enabledChefIds = $("#chk-cal-partial-ultimate").val() || [];
    var rule = calCustomRule.rules[0];
    if (!rule || !rule.chefs) return { nextChefs: [], partialChefs: [] };
    
    var nextChefs = [];     // NEXT类厨师
    var partialChefs = [];  // Partial技法加成类厨师
    
    for (var i = 0; i < enabledChefIds.length; i++) {
        var chefId = Number(enabledChefIds[i]);
        var chef = null;
        for (var j = 0; j < rule.chefs.length; j++) {
            if (rule.chefs[j].chefId === chefId) {
                chef = rule.chefs[j];
                break;
            }
        }
        if (!chef || !chef.ultimateSkillEffect) continue;
        
        var chefType = null;
        var skillBonus = { stirfry: 0, boil: 0, knife: 0, fry: 0, bake: 0, steam: 0 };
        var hasSkillBonus = false;
        var conditionType = null;      // 技能条件类型（如 "ChefTag"）
        var conditionValueList = null; // 技能条件值列表（如 [151]）
        
        for (var k = 0; k < chef.ultimateSkillEffect.length; k++) {
            var effect = chef.ultimateSkillEffect[k];
            
            // 跳过时间类技能
            if (effect.type === "OpenTime" || effect.type === "CookbookTime") continue;
            
            if (effect.condition === "Next") {
                chefType = "Next";
                extractSkillBonusForQuery(effect, skillBonus);
                if (isSkillBonusTypeForQuery(effect.type)) hasSkillBonus = true;
                // 保存条件信息
                if (effect.conditionType) conditionType = effect.conditionType;
                if (effect.conditionValueList) conditionValueList = effect.conditionValueList;
            } else if (effect.condition === "Partial") {
                // Partial类只要技法加成类的
                if (isSkillBonusTypeForQuery(effect.type)) {
                    if (chefType !== "Next") chefType = "Partial";
                    extractSkillBonusForQuery(effect, skillBonus);
                    hasSkillBonus = true;
                    // 保存条件信息
                    if (effect.conditionType) conditionType = effect.conditionType;
                    if (effect.conditionValueList) conditionValueList = effect.conditionValueList;
                }
            }
        }
        
        if (chefType === "Next") {
            nextChefs.push({
                chef: chef,
                type: "Next",
                skillBonus: skillBonus,
                totalBonus: getTotalSkillBonusForQuery(skillBonus),
                conditionType: conditionType,
                conditionValueList: conditionValueList
            });
        } else if (chefType === "Partial" && hasSkillBonus) {
            partialChefs.push({
                chef: chef,
                type: "Partial",
                skillBonus: skillBonus,
                totalBonus: getTotalSkillBonusForQuery(skillBonus),
                conditionType: conditionType,
                conditionValueList: conditionValueList
            });
        }
    }
    
    // 按技法加成总值降序排序
    nextChefs.sort(function(a, b) { return b.totalBonus - a.totalBonus; });
    partialChefs.sort(function(a, b) { return b.totalBonus - a.totalBonus; });
    
    return { nextChefs: nextChefs, partialChefs: partialChefs };
}

// ==================== 技法加成处理 ====================

// 技法类型常量
var SKILL_TYPES = ["stirfry", "boil", "knife", "fry", "bake", "steam"];
var SKILL_EFFECT_MAP = {
    "Stirfry": "stirfry", 
    "Boil": "boil", 
    "Knife": "knife", 
    "Fry": "fry",
    "Bake": "bake", 
    "Steam": "steam",
};

/**
 * 获取厨师的技法值
 */
function getChefSkillVal(chef, skill) {
    return chef[skill + "Val"] || chef[skill] || 0;
}

/**
 * 创建空的技法加成对象
 */
function createEmptySkillBonus() {
    return { stirfry: 0, boil: 0, knife: 0, fry: 0, bake: 0, steam: 0 };
}

/**
 * 判断是否为技法加成类型
 */
function isSkillBonusTypeForQuery(type) {
    return SKILL_EFFECT_MAP[type] !== undefined;
}

/**
 * 检查目标厨师是否满足光环厨师的技能条件
 * @param targetChef - 目标厨师（被加成的厨师）
 * @param auraChef - 光环厨师数据（包含conditionType和conditionValueList）
 * @returns {boolean} - 是否满足条件
 */
function checkAuraConditionForQuery(targetChef, auraChef) {
    // 如果没有条件限制，对所有厨师生效
    if (!auraChef.conditionType || !auraChef.conditionValueList) {
        return true;
    }
    
    // 处理 ChefTag 条件类型
    if (auraChef.conditionType === "ChefTag") {
        // 检查目标厨师的tags是否包含条件值列表中的任意一个
        var targetTags = targetChef.tags || [];
        for (var i = 0; i < auraChef.conditionValueList.length; i++) {
            var requiredTag = auraChef.conditionValueList[i];
            if (targetTags.indexOf(requiredTag) >= 0) {
                return true;
            }
        }
        return false;
    }
    
    // 其他条件类型暂时默认通过
    return true;
}

/**
 * 提取技法加成值
 */
function extractSkillBonusForQuery(effect, skillBonus) {
    var value = effect.value || 0;
    var skill = SKILL_EFFECT_MAP[effect.type];
    if (skill) {
        skillBonus[skill] += value;
    }
}

/**
 * 获取技法加成总值
 */
function getTotalSkillBonusForQuery(skillBonus) {
    var total = 0;
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        total += skillBonus[SKILL_TYPES[i]];
    }
    return total;
}

/**
 * 获取厨师的第一个修炼任务
 */
function getChefFirstUltimateQuestForQuery(chef, gameData) {
    var originalChef = null;
    for (var i = 0; i < gameData.chefs.length; i++) {
        if (gameData.chefs[i].chefId === chef.chefId) {
            originalChef = gameData.chefs[i];
            break;
        }
    }
    
    if (!originalChef || !originalChef.ultimateGoal || originalChef.ultimateGoal.length === 0) {
        return null;
    }
    
    var questId = originalChef.ultimateGoal[0];
    for (var i = 0; i < gameData.quests.length; i++) {
        if (gameData.quests[i].questId === questId && gameData.quests[i].conditions) {
            return gameData.quests[i];
        }
    }
    return null;
}

// ==================== 厨师技法处理 ====================

/**
 * 应用技法加成到厨师（使用 setDataForChef 正确计算，包含百分比加成）
 * @param {Object} chef - 厨师对象（原始数据）
 * @param {Array} auraEffects - 光环厨师的修炼技能效果数组
 * @param {Object} rule - 规则对象
 * @returns {Object} 包含正确技法值的厨师对象
 */
function applyAuraEffectsToChef(chef, auraEffects, rule) {
    var boosted = JSON.parse(JSON.stringify(chef));
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    var useAmber = $("#chk-cal-use-amber").prop("checked");
    var equipToUse = useEquip ? boosted.equip : null;
    
    setDataForChef(
        boosted,
        equipToUse,
        true,
        rule.calGlobalUltimateData,
        auraEffects, // 光环加成
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        useAmber,
        rule.calQixiaData || null
    );
    
    return boosted;
}

/**
 * 应用技法加成到厨师（简单版本，直接加到最终值上）
 * 注意：这个函数不考虑百分比加成，仅用于简单场景
 * 对于需要正确计算百分比加成的场景，请使用 applyAuraEffectsToChef
 */
function applySkillBonusToChef(chef, skillBonus) {
    var boosted = JSON.parse(JSON.stringify(chef));
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        var skill = SKILL_TYPES[i];
        boosted[skill + "Val"] = getChefSkillVal(boosted, skill) + skillBonus[skill];
    }
    return boosted;
}


// ==================== 统一策略函数 ====================

/**
 * 统一策略函数：根据未修炼厨师数量动态分配NEXT/Partial厨师
 * 支持NEXT厨师（只对紧邻的下一个厨师生效）和Partial厨师（对所有厨师生效）
 * 
 * 优化后的策略逻辑（直接顺序评估，避免生成所有方案）：
 * - 1个厨师：顺序尝试 无光环 → NEXT → NEXT+Partial → 2 Partials，达到3神就停止
 * - 2个厨师：两阶段评估，比较哪个厨师放第二位（获得NEXT加成）更优
 * - 3个厨师：无空位放光环厨师，直接评估
 */
function queryUnifiedStrategy(gameData, targetChefs, auraChefs) {
    var rule = calCustomRule.rules[0];
    var chefCount = targetChefs.length;
    var availableAuraSlots = 3 - chefCount;
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    
    /**
     * 获取厨师自身的Partial技法加成（如果是已修炼的Partial厨师且在"上场类已修炼"中勾选）
     */
    function getSelfPartialBonus(chef) {
        var bonus = createEmptySkillBonus();
        if (!chef.ultimateSkillEffect) return null;
        
        // 检查厨师是否在"上场类已修炼"下拉框中被勾选
        var enabledChefIds = $("#chk-cal-partial-ultimate").val() || [];
        var isEnabled = enabledChefIds.indexOf(String(chef.chefId)) >= 0 || 
                        enabledChefIds.indexOf(chef.chefId) >= 0;
        if (!isEnabled) return null;
        
        var hasPartialSkillBonus = false;
        for (var k = 0; k < chef.ultimateSkillEffect.length; k++) {
            var effect = chef.ultimateSkillEffect[k];
            if (effect.condition === "Partial" && isSkillBonusTypeForQuery(effect.type)) {
                // 检查技能条件
                if (effect.conditionType === "ChefTag" && effect.conditionValueList) {
                    var chefTags = chef.tags || [];
                    var meetsCondition = false;
                    for (var c = 0; c < effect.conditionValueList.length; c++) {
                        if (chefTags.indexOf(effect.conditionValueList[c]) >= 0) {
                            meetsCondition = true;
                            break;
                        }
                    }
                    if (!meetsCondition) {
                        continue; // 跳过这个技能效果
                    }
                }
                extractSkillBonusForQuery(effect, bonus);
                hasPartialSkillBonus = true;
            }
        }
        
        return hasPartialSkillBonus ? bonus : null;
    }
    
    /**
     * 移除厨具加成，返回基础厨师
     */
    function removeEquipBonus(chef, equipBonus) {
        var baseChef = JSON.parse(JSON.stringify(chef));
        for (var i = 0; i < SKILL_TYPES.length; i++) {
            var skill = SKILL_TYPES[i];
            baseChef[skill + "Val"] = getChefSkillVal(baseChef, skill) - equipBonus[skill];
        }
        return baseChef;
    }
    
    // 获取所有厨师的数据
    var baseChefs = [];
    for (var i = 0; i < targetChefs.length; i++) {
        var chef = targetChefs[i].chef;
        var originalEquip = targetChefs[i].originalEquip;
        var hasEquip = originalEquip && originalEquip.equipId;
        
        var selfPartialBonus = getSelfPartialBonus(chef);
        var chefForCalc = JSON.parse(JSON.stringify(chef));
        
        if (selfPartialBonus) {
            chefForCalc = applySkillBonusToChef(chefForCalc, selfPartialBonus);
        }
        
        // baseChef 用于厨具推荐计算，需要不含当前厨具加成的基础厨师
        var baseChef;
        if (useEquip && hasEquip) {
            baseChef = removeEquipBonus(chef, getEquipSkillBonus(originalEquip));
        } else {
            baseChef = JSON.parse(JSON.stringify(chef));
        }
        
        baseChefs.push({
            chef: chef,
            chefForCalc: chefForCalc,
            baseChef: baseChef,
            quest: targetChefs[i].quest,
            hasEquip: hasEquip,
            originalEquip: originalEquip,
            selfPartialBonus: selfPartialBonus
        });
    }
    
    var totalRecipeCount = chefCount * 3;
    
    /**
     * 为单个厨师查询菜谱并计算神级数（使用 setDataForChef 正确计算光环加成）
     * @param originalChef - 原始厨师数据（从 rule.chefs 获取）
     * @param quest - 修炼任务
     * @param auraChefs - 光环厨师数组（包含 chef 属性，其中有 ultimateSkillEffect）
     * @param usedRecipeIds - 已使用的菜谱ID
     */
    function queryOneChefRecipes(originalChef, quest, auraChefs, usedRecipeIds) {
        // 深拷贝厨师数据
        var boostedChef = JSON.parse(JSON.stringify(originalChef));
        
        // 收集光环厨师的修炼技能效果（只收集技法加成类）
        var partialAdds = [];
        if (auraChefs && auraChefs.length > 0) {
            for (var a = 0; a < auraChefs.length; a++) {
                var auraChef = auraChefs[a];
                if (auraChef.chef && auraChef.chef.ultimateSkillEffect) {
                    for (var e = 0; e < auraChef.chef.ultimateSkillEffect.length; e++) {
                        var effect = auraChef.chef.ultimateSkillEffect[e];
                        // 只处理技法加成类型
                        var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                        if (!effectSkillType) continue;
                        
                        // 检查条件是否满足
                        if (effect.conditionType === "ChefTag" && effect.conditionValueList) {
                            var targetTags = originalChef.tags || [];
                            var tagMatch = false;
                            for (var t = 0; t < effect.conditionValueList.length; t++) {
                                if (targetTags.indexOf(effect.conditionValueList[t]) >= 0) {
                                    tagMatch = true;
                                    break;
                                }
                            }
                            if (!tagMatch) continue;
                        }
                        // 只收集对应类型的效果
                        if (auraChef.type === "Next" && effect.condition === "Next") {
                            partialAdds.push(effect);
                        } else if (auraChef.type === "Partial" && effect.condition === "Partial") {
                            partialAdds.push(effect);
                        }
                    }
                }
            }
        }
        
        // 使用 setDataForChef 计算包含光环加成的技法值
        var useAmber = $("#chk-cal-use-amber").prop("checked");
        var useEquip = $("#chk-cal-use-equip").prop("checked");
        var equipToUse = useEquip ? boostedChef.equip : null;
        setDataForChef(
            boostedChef,
            equipToUse,
            true,
            rule.calGlobalUltimateData,
            partialAdds,
            rule.calSelfUltimateData,
            rule.calActivityUltimateData,
            true,
            rule,
            useAmber,
            rule.calQixiaData || null
        );
        
        var recipes = queryRecipesForQuestCondition(rule, quest, boostedChef, usedRecipeIds);
        var selectedRecipes = recipes.slice(0, 3);
        
        var godCount = 0;
        var maxDeficitBySkill = createEmptySkillBonus();
        
        for (var j = 0; j < selectedRecipes.length; j++) {
            var diff = calculateSkillDiffForQuery(boostedChef, selectedRecipes[j], 4);
            if (diff.value === 0) {
                godCount++;
            } else {
                var detailedDiff = calculateDetailedSkillDiffForQuery(boostedChef, selectedRecipes[j], 4);
                for (var k = 0; k < SKILL_TYPES.length; k++) {
                    var skill = SKILL_TYPES[k];
                    if (detailedDiff[skill] < 0) {
                        maxDeficitBySkill[skill] = Math.max(maxDeficitBySkill[skill], Math.abs(detailedDiff[skill]));
                    }
                }
            }
        }
        
        var totalDiff = getTotalSkillBonusForQuery(maxDeficitBySkill);
        
        // 判断是否可通过厨具补救
        var useStrongEquip = $("#chk-unultimated-use-strong-equip").prop("checked");
        var equipMaxBonus = useStrongEquip ? 999 : 100;
        var canBeFixed = true;
        for (var k = 0; k < SKILL_TYPES.length; k++) {
            if (maxDeficitBySkill[SKILL_TYPES[k]] > equipMaxBonus) {
                canBeFixed = false;
                break;
            }
        }
        
        return {
            recipes: selectedRecipes,
            godCount: godCount,
            totalDiff: totalDiff,
            canBeFixed: canBeFixed,
            boostedChef: boostedChef
        };
    }
    
    // ========== 优先判断：不使用光环厨师能否直接全部达神 ==========
    var noAuraUsedRecipeIds = [];
    var noAuraResults = [];
    var noAuraTotalGodCount = 0;
    var allChefsCanReachFullGod = true;
    
    for (var i = 0; i < baseChefs.length; i++) {
        var data = baseChefs[i];
        var result = queryOneChefRecipes(data.chef, data.quest, null, noAuraUsedRecipeIds);
        
        for (var j = 0; j < result.recipes.length; j++) {
            noAuraUsedRecipeIds.push(result.recipes[j].recipeId);
        }
        
        noAuraTotalGodCount += result.godCount;
        noAuraResults.push({
            chef: data.chef,
            chefForCalc: result.boostedChef,
            baseChef: data.baseChef,
            recipes: result.recipes,
            godCount: result.godCount,
            auraChefs: null,
            hasEquip: data.hasEquip,
            originalEquip: data.originalEquip
        });
        
        if (result.godCount < 3) {
            allChefsCanReachFullGod = false;
        }
    }
    
    // 如果所有厨师都能直接达到3道神级，直接返回
    if (allChefsCanReachFullGod) {
        var positions = [];
        for (var i = 0; i < noAuraResults.length; i++) {
            positions.push({
                type: "target",
                chef: noAuraResults[i].chef,
                recipes: noAuraResults[i].recipes,
                recommendedEquip: null
            });
        }
        while (positions.length < 3) {
            positions.push({ type: "empty" });
        }
        
        return {
            success: true,
            positions: positions,
            message: "无需光环厨师（" + totalRecipeCount + "/" + totalRecipeCount + "达神）"
        };
    }
    
    // ========== 根据厨师数量选择不同策略 ==========
    
    /**
     * 评估一个方案（基础评估，不计算厨具补充）
     * @param scheme - 方案配置 { positions: [{type, auraChef?, targetIndex?}], description }
     */
    function evaluateScheme(scheme) {
        var results = [];
        var usedRecipeIds = [];
        var totalGodCount = 0;
        var totalDiff = 0;
        
        // 计算每个目标厨师获得的光环厨师列表
        var targetAuraChefs = [];
        for (var i = 0; i < baseChefs.length; i++) {
            targetAuraChefs[i] = [];
        }
        
        // 遍历方案中的位置，收集光环厨师
        var nextAuraChef = null;
        var nextChefTargetIndex = -1;
        
        for (var p = 0; p < scheme.positions.length; p++) {
            var pos = scheme.positions[p];
            
            if (pos.type === "next" && pos.auraChef) {
                nextAuraChef = pos.auraChef;
                // 找到下一个目标厨师的索引
                for (var np = p + 1; np < scheme.positions.length; np++) {
                    if (scheme.positions[np].type === "target") {
                        nextChefTargetIndex = scheme.positions[np].targetIndex;
                        break;
                    }
                }
            } else if (pos.type === "partial" && pos.auraChef) {
                // Partial厨师加成给满足条件的目标厨师
                for (var t = 0; t < targetAuraChefs.length; t++) {
                    // 检查目标厨师是否满足光环厨师的技能条件
                    if (checkAuraConditionForQuery(baseChefs[t].chef, pos.auraChef)) {
                        targetAuraChefs[t].push(pos.auraChef);
                    }
                }
            }
        }
        
        // 如果有NEXT厨师，将其添加到目标厨师的光环列表（需要检查条件）
        if (nextAuraChef && nextChefTargetIndex >= 0) {
            // 检查目标厨师是否满足NEXT光环厨师的技能条件
            if (checkAuraConditionForQuery(baseChefs[nextChefTargetIndex].chef, nextAuraChef)) {
                targetAuraChefs[nextChefTargetIndex].push(nextAuraChef);
            }
        }
        
        // 按方案中目标厨师的顺序查询菜谱
        var targetOrder = [];
        for (var p = 0; p < scheme.positions.length; p++) {
            if (scheme.positions[p].type === "target") {
                targetOrder.push(scheme.positions[p].targetIndex);
            }
        }
        
        // 为每个目标厨师查询菜谱
        var allCanBeFixed = true;
        for (var i = 0; i < targetOrder.length; i++) {
            var targetIdx = targetOrder[i];
            var data = baseChefs[targetIdx];
            var auraChefList = targetAuraChefs[targetIdx];
            
            // 使用原始厨师数据和光环厨师列表进行计算
            var result = queryOneChefRecipes(data.chef, data.quest, auraChefList.length > 0 ? auraChefList : null, usedRecipeIds);
            
            // 记录已使用的菜谱
            for (var j = 0; j < result.recipes.length; j++) {
                usedRecipeIds.push(result.recipes[j].recipeId);
            }
            
            totalGodCount += result.godCount;
            totalDiff += result.totalDiff;
            if (!result.canBeFixed) allCanBeFixed = false;
            
            results[targetIdx] = {
                chef: data.chef,
                chefForCalc: result.boostedChef,
                baseChef: data.baseChef,
                recipes: result.recipes,
                godCount: result.godCount,
                auraChefs: auraChefList,
                hasEquip: data.hasEquip,
                originalEquip: data.originalEquip,
                canBeFixed: result.canBeFixed
            };
        }
        
        return {
            results: results,
            totalGodCount: totalGodCount,
            totalDiff: totalDiff,
            canBeFixed: allCanBeFixed,
            positions: scheme.positions
        };
    }
    
    /**
     * 计算方案的潜在神级数（厨具补充后）
     * 只在需要时调用，避免每个方案都计算
     */
    function calculatePotentialGodCount(evalResult) {
        var potentialGodCount = 0;
        for (var i = 0; i < evalResult.results.length; i++) {
            var r = evalResult.results[i];
            if (!r) continue;
            
            var chefPotentialGodCount = r.godCount;
            if (r.godCount < 3) {
                var equipResult = tryFindEquipForNotGodRecipes(r.baseChef, r.recipes, r.auraChefs || r.bonus || [], gameData);
                if (equipResult && equipResult.equip) {
                    var newGodCount = 3 - (equipResult.totalNotGod - equipResult.satisfiedCount);
                    if (newGodCount > r.godCount) {
                        chefPotentialGodCount = newGodCount;
                    }
                }
            }
            potentialGodCount += chefPotentialGodCount;
        }
        return potentialGodCount;
    }
    
    if (chefCount === 3) {
        // 3个厨师，没有空位放光环厨师，直接返回无光环结果
        var positions = [];
        var recommendedEquips = {};
        var finalGodCount = noAuraTotalGodCount;
        
        // 厨具补充
        for (var i = 0; i < noAuraResults.length; i++) {
            var r = noAuraResults[i];
            if (r.godCount < 3) {
                var equipResult = tryFindEquipForNotGodRecipes(r.baseChef, r.recipes, null, gameData);
                if (equipResult && equipResult.equip) {
                    var newGodCount = 3 - (equipResult.totalNotGod - equipResult.satisfiedCount);
                    if (newGodCount > r.godCount) {
                        recommendedEquips[i] = equipResult.equip;
                        finalGodCount += (newGodCount - r.godCount);
                    }
                }
            }
            positions.push({
                type: "target",
                chef: r.chef,
                recipes: r.recipes,
                recommendedEquip: recommendedEquips[i] || null
            });
        }
        
        return {
            success: true,
            positions: positions,
            message: "无光环厨师（" + finalGodCount + "/" + totalRecipeCount + "达神）"
        };
        
    } else if (chefCount === 1) {
        // 1个厨师，2个空位 - 评估所有光环组合，选择最优
        // 优先级：达神数 > 可补救性 > 差值
        var data = baseChefs[0];
        var bestEvalResult = null;
        var bestSchemeDesc = "无光环厨师";
        var bestCanBeFixed = false;
        
        /**
         * 比较两个结果，判断新结果是否更优
         * 优先级：达神数 > 可补救性 > 差值
         */
        function isBetterResult(newResult, oldGodCount, oldCanBeFixed, oldDiff) {
            // 1. 达神数更高
            if (newResult.godCount > oldGodCount) return true;
            if (newResult.godCount < oldGodCount) return false;
            // 2. 达神数相同，可补救优先
            if (newResult.canBeFixed && !oldCanBeFixed) return true;
            if (!newResult.canBeFixed && oldCanBeFixed) return false;
            // 3. 可补救性相同，差值更低
            return newResult.totalDiff < oldDiff;
        }
        
        // 使用第二步已计算的无光环结果作为基准（避免重复计算）
        var noAuraResultForChef = noAuraResults[0];
        // 重新计算无光环的详细信息（包含canBeFixed）
        var noAuraDetailResult = queryOneChefRecipes(data.chef, data.quest, [], []);
        
        bestEvalResult = {
            results: [{
                chef: noAuraResultForChef.chef,
                chefForCalc: noAuraResultForChef.chefForCalc,
                baseChef: noAuraResultForChef.baseChef,
                recipes: noAuraResultForChef.recipes,
                godCount: noAuraResultForChef.godCount,
                bonus: null,
                hasEquip: noAuraResultForChef.hasEquip,
                originalEquip: noAuraResultForChef.originalEquip
            }],
            totalGodCount: noAuraResultForChef.godCount,
            totalDiff: noAuraDetailResult.totalDiff,
            positions: [{ type: "target", targetIndex: 0 }, { type: "empty" }, { type: "empty" }]
        };
        bestCanBeFixed = noAuraDetailResult.canBeFixed;
        
        // 如果无光环已达3神，跳过后续评估（第二步已判断，这里是双重保险）
        if (bestEvalResult.totalGodCount < 3) {
            // 遍历有光环组合
            
            // 1. 尝试单个NEXT厨师
            for (var n = 0; n < auraChefs.nextChefs.length; n++) {
                var nextChef = auraChefs.nextChefs[n];
                if (!checkAuraConditionForQuery(data.chef, nextChef)) continue;
                
                var result = queryOneChefRecipes(data.chef, data.quest, [nextChef], []);
                if (isBetterResult(result, bestEvalResult.totalGodCount, bestCanBeFixed, bestEvalResult.totalDiff)) {
                    bestEvalResult = {
                        results: [{
                            chef: data.chef, chefForCalc: result.boostedChef, baseChef: data.baseChef,
                            recipes: result.recipes, godCount: result.godCount, bonus: [nextChef],
                            hasEquip: data.hasEquip, originalEquip: data.originalEquip
                        }],
                        totalGodCount: result.godCount,
                        totalDiff: result.totalDiff,
                        positions: [
                            { type: "next", auraChef: nextChef },
                            { type: "target", targetIndex: 0 },
                            { type: "empty" }
                        ]
                    };
                    bestCanBeFixed = result.canBeFixed;
                    bestSchemeDesc = "NEXT(" + nextChef.chef.name + ")";
                }
            }
            
            // 2. 尝试NEXT + Partial组合
            for (var n = 0; n < auraChefs.nextChefs.length; n++) {
                var nextChef = auraChefs.nextChefs[n];
                if (!checkAuraConditionForQuery(data.chef, nextChef)) continue;
                
                for (var p = 0; p < auraChefs.partialChefs.length; p++) {
                    var partialChef = auraChefs.partialChefs[p];
                    if (!checkAuraConditionForQuery(data.chef, partialChef)) continue;
                    
                    var result = queryOneChefRecipes(data.chef, data.quest, [nextChef, partialChef], []);
                    if (isBetterResult(result, bestEvalResult.totalGodCount, bestCanBeFixed, bestEvalResult.totalDiff)) {
                        bestEvalResult = {
                            results: [{
                                chef: data.chef, chefForCalc: result.boostedChef, baseChef: data.baseChef,
                                recipes: result.recipes, godCount: result.godCount, bonus: [nextChef, partialChef],
                                hasEquip: data.hasEquip, originalEquip: data.originalEquip
                            }],
                            totalGodCount: result.godCount,
                            totalDiff: result.totalDiff,
                            positions: [
                                { type: "next", auraChef: nextChef },
                                { type: "target", targetIndex: 0 },
                                { type: "partial", auraChef: partialChef }
                            ]
                        };
                        bestCanBeFixed = result.canBeFixed;
                        bestSchemeDesc = "NEXT(" + nextChef.chef.name + ") + Partial(" + partialChef.chef.name + ")";
                    }
                }
            }
            
            // 3. 尝试2个Partial厨师
            for (var p1 = 0; p1 < auraChefs.partialChefs.length; p1++) {
                var partial1 = auraChefs.partialChefs[p1];
                if (!checkAuraConditionForQuery(data.chef, partial1)) continue;
                
                for (var p2 = p1 + 1; p2 < auraChefs.partialChefs.length; p2++) {
                    var partial2 = auraChefs.partialChefs[p2];
                    if (!checkAuraConditionForQuery(data.chef, partial2)) continue;
                    
                    var result = queryOneChefRecipes(data.chef, data.quest, [partial1, partial2], []);
                    if (isBetterResult(result, bestEvalResult.totalGodCount, bestCanBeFixed, bestEvalResult.totalDiff)) {
                        bestEvalResult = {
                            results: [{
                                chef: data.chef, chefForCalc: result.boostedChef, baseChef: data.baseChef,
                                recipes: result.recipes, godCount: result.godCount, bonus: [partial1, partial2],
                                hasEquip: data.hasEquip, originalEquip: data.originalEquip
                            }],
                            totalGodCount: result.godCount,
                            totalDiff: result.totalDiff,
                            positions: [
                                { type: "partial", auraChef: partial1 },
                                { type: "partial", auraChef: partial2 },
                                { type: "target", targetIndex: 0 }
                            ]
                        };
                        bestCanBeFixed = result.canBeFixed;
                        bestSchemeDesc = "Partial(" + partial1.chef.name + " + " + partial2.chef.name + ")";
                    }
                }
            }
        }
        
        // 厨具补充
        var recommendedEquip = null;
        var finalGodCount = bestEvalResult.totalGodCount;
        if (bestEvalResult.totalGodCount < 3 && bestEvalResult.results[0]) {
            var r = bestEvalResult.results[0];
            var equipResult = tryFindEquipForNotGodRecipes(r.baseChef, r.recipes, r.bonus || [], gameData);
            if (equipResult && equipResult.equip) {
                var newGodCount = 3 - (equipResult.totalNotGod - equipResult.satisfiedCount);
                if (newGodCount > r.godCount) {
                    recommendedEquip = equipResult.equip;
                    finalGodCount = newGodCount;
                }
            }
        }
        
        // 构建返回结果
        var positions = [];
        for (var p = 0; p < bestEvalResult.positions.length; p++) {
            var pos = bestEvalResult.positions[p];
            if (pos.type === "next" && pos.auraChef) {
                positions.push({ type: "aura", chef: pos.auraChef.chef, auraType: "next" });
            } else if (pos.type === "partial" && pos.auraChef) {
                positions.push({ type: "aura", chef: pos.auraChef.chef, auraType: "partial" });
            } else if (pos.type === "target") {
                positions.push({
                    type: "target",
                    chef: bestEvalResult.results[0].chef,
                    recipes: bestEvalResult.results[0].recipes,
                    recommendedEquip: recommendedEquip
                });
            } else if (pos.type === "empty") {
                positions.push({ type: "empty" });
            }
        }
        while (positions.length < 3) {
            positions.push({ type: "empty" });
        }
        
        return {
            success: bestEvalResult.results[0] && bestEvalResult.results[0].recipes.length >= 3,
            positions: positions,
            message: bestSchemeDesc + "（" + finalGodCount + "/3达神）"
        };
        
    } else if (chefCount === 2) {
        // 2个厨师，1个空位 - 使用两阶段评估（需要比较哪个厨师放第二位更优）
        
        // 使用第二步已计算的无光环结果作为基准
        var noAuraScheme = {
            positions: [
                { type: "target", targetIndex: 0 },
                { type: "target", targetIndex: 1 },
                { type: "empty" }
            ],
            description: "无光环厨师"
        };
        
        // 计算无光环结果的canBeFixed（需要重新评估以获取详细信息）
        var noAuraEvalResult = evaluateScheme(noAuraScheme);
        
        // 生成有光环的方案（不包含无光环方案，因为第二步已经计算过）
        var allSchemes = [];
        
        // 方案1：NEXT + 厨师A + 厨师B（NEXT给厨师A加成）
        for (var n = 0; n < auraChefs.nextChefs.length; n++) {
            allSchemes.push({
                positions: [
                    { type: "next", auraChef: auraChefs.nextChefs[n] },
                    { type: "target", targetIndex: 0 },
                    { type: "target", targetIndex: 1 }
                ],
                description: "NEXT(" + auraChefs.nextChefs[n].chef.name + ") -> " + baseChefs[0].chef.name
            });
        }
        
        // 方案2：NEXT + 厨师B + 厨师A（NEXT给厨师B加成）
        for (var n = 0; n < auraChefs.nextChefs.length; n++) {
            allSchemes.push({
                positions: [
                    { type: "next", auraChef: auraChefs.nextChefs[n] },
                    { type: "target", targetIndex: 1 },
                    { type: "target", targetIndex: 0 }
                ],
                description: "NEXT(" + auraChefs.nextChefs[n].chef.name + ") -> " + baseChefs[1].chef.name
            });
        }
        
        // 方案3：Partial + 厨师A + 厨师B
        for (var p = 0; p < auraChefs.partialChefs.length; p++) {
            allSchemes.push({
                positions: [
                    { type: "partial", auraChef: auraChefs.partialChefs[p] },
                    { type: "target", targetIndex: 0 },
                    { type: "target", targetIndex: 1 }
                ],
                description: "Partial(" + auraChefs.partialChefs[p].chef.name + ")"
            });
        }
        
        // 将无光环结果作为初始最优方案
        var bestScheme = noAuraScheme;
        var bestResult = noAuraEvalResult;
        var maxGodCount = noAuraEvalResult.totalGodCount;
        var bestCanBeFixed = noAuraEvalResult.canBeFixed;
        
        // 第一阶段：评估所有有光环方案，与无光环基准比较
        var candidateSchemes = [{ scheme: noAuraScheme, evalResult: noAuraEvalResult }];
        
        for (var s = 0; s < allSchemes.length; s++) {
            var scheme = allSchemes[s];
            var evalResult = evaluateScheme(scheme);
            
            // 比较优先级：达神数 > 可补救性
            var dominated = false;
            var dominated_by = [];
            
            for (var c = 0; c < candidateSchemes.length; c++) {
                var existing = candidateSchemes[c].evalResult;
                // 如果现有方案达神数更高，或达神数相同但可补救性更好
                if (existing.totalGodCount > evalResult.totalGodCount) {
                    dominated = true;
                    break;
                }
                if (existing.totalGodCount === evalResult.totalGodCount && 
                    existing.canBeFixed && !evalResult.canBeFixed) {
                    dominated = true;
                    break;
                }
                // 如果新方案更优，标记现有方案被淘汰
                if (evalResult.totalGodCount > existing.totalGodCount ||
                    (evalResult.totalGodCount === existing.totalGodCount && 
                     evalResult.canBeFixed && !existing.canBeFixed)) {
                    dominated_by.push(c);
                }
            }
            
            if (!dominated) {
                // 移除被新方案淘汰的方案
                for (var d = dominated_by.length - 1; d >= 0; d--) {
                    candidateSchemes.splice(dominated_by[d], 1);
                }
                candidateSchemes.push({ scheme: scheme, evalResult: evalResult });
                if (evalResult.totalGodCount > maxGodCount) {
                    maxGodCount = evalResult.totalGodCount;
                }
            }
        }
        
        // 过滤候选方案：只保留达神数最高且可补救性最好的
        var bestCanBeFixed = false;
        for (var c = 0; c < candidateSchemes.length; c++) {
            if (candidateSchemes[c].evalResult.totalGodCount === maxGodCount && 
                candidateSchemes[c].evalResult.canBeFixed) {
                bestCanBeFixed = true;
                break;
            }
        }
        candidateSchemes = candidateSchemes.filter(function(c) {
            return c.evalResult.totalGodCount === maxGodCount &&
                   (c.evalResult.canBeFixed === bestCanBeFixed || !bestCanBeFixed);
        });
        
        // 第二阶段：如果有多个候选方案且未达到全神，计算潜在神级数
        var bestPotentialGodCount = -1;
        var bestTotalDiff = Infinity;
        
        if (candidateSchemes.length === 1) {
            bestScheme = candidateSchemes[0].scheme;
            bestResult = candidateSchemes[0].evalResult;
        } else if (candidateSchemes.length > 1) {
            if (maxGodCount < totalRecipeCount) {
                // 未达到全神，计算潜在神级数
                for (var c = 0; c < candidateSchemes.length; c++) {
                    var candidate = candidateSchemes[c];
                    var potentialGodCount = calculatePotentialGodCount(candidate.evalResult);
                    
                    var isBetter = false;
                    if (potentialGodCount > bestPotentialGodCount) {
                        isBetter = true;
                    } else if (potentialGodCount === bestPotentialGodCount && candidate.evalResult.totalDiff < bestTotalDiff) {
                        isBetter = true;
                    }
                    
                    if (isBetter) {
                        bestScheme = candidate.scheme;
                        bestResult = candidate.evalResult;
                        bestPotentialGodCount = potentialGodCount;
                        bestTotalDiff = candidate.evalResult.totalDiff;
                    }
                }
            } else {
                // 已达到全神，按总差值选择
                for (var c = 0; c < candidateSchemes.length; c++) {
                    var candidate = candidateSchemes[c];
                    if (candidate.evalResult.totalDiff < bestTotalDiff) {
                        bestScheme = candidate.scheme;
                        bestResult = candidate.evalResult;
                        bestTotalDiff = candidate.evalResult.totalDiff;
                    }
                }
            }
        }
        
        // 厨具补充
        var recommendedEquips = {};
        var finalGodCount = maxGodCount;
        
        if (maxGodCount < totalRecipeCount && bestResult) {
            for (var i = 0; i < bestResult.results.length; i++) {
                var r = bestResult.results[i];
                if (r && r.godCount < 3) {
                    var equipResult = tryFindEquipForNotGodRecipes(r.baseChef, r.recipes, r.auraChefs || [], gameData);
                    if (equipResult && equipResult.equip) {
                        var newGodCount = 3 - (equipResult.totalNotGod - equipResult.satisfiedCount);
                        if (newGodCount > r.godCount) {
                            recommendedEquips[i] = equipResult.equip;
                            finalGodCount += (newGodCount - r.godCount);
                        }
                    }
                }
            }
        }
        
        // 构建返回结果
        var positions = [];
        
        if (bestResult && bestResult.positions) {
            for (var p = 0; p < bestResult.positions.length; p++) {
                var pos = bestResult.positions[p];
                
                if (pos.type === "next" && pos.auraChef) {
                    positions.push({ type: "aura", chef: pos.auraChef.chef, auraType: "next" });
                } else if (pos.type === "partial" && pos.auraChef) {
                    positions.push({ type: "aura", chef: pos.auraChef.chef, auraType: "partial" });
                } else if (pos.type === "target") {
                    var targetIdx = pos.targetIndex;
                    var r = bestResult.results[targetIdx];
                    positions.push({
                        type: "target",
                        chef: r.chef,
                        recipes: r.recipes,
                        recommendedEquip: recommendedEquips[targetIdx] || null
                    });
                } else if (pos.type === "empty") {
                    positions.push({ type: "empty" });
                }
            }
        }
        
        while (positions.length < 3) {
            positions.push({ type: "empty" });
        }
        
        var message = bestScheme ? bestScheme.description : "无光环厨师";
        message += "（" + finalGodCount + "/" + totalRecipeCount + "达神）";
        
        return {
            success: bestResult ? bestResult.results.every(function(r) { return r && r.recipes.length >= 3; }) : false,
            positions: positions,
            message: message
        };
    }
    
    // 默认返回（不应该到达这里）
    return {
        success: false,
        positions: [],
        message: "未知错误"
    };
}


// ==================== 菜谱查询和匹配 ====================

/**
 * 查询满足修炼任务条件的菜谱
 */
function queryRecipesForQuestCondition(rule, quest, chef, usedRecipeIds) {
    if (!quest || !quest.conditions || quest.conditions.length === 0) {
        return [];
    }
    
    var filteredRecipes = [];
    var menus = rule.menus || [];
    
    var needGodRank = false;
    for (var c in quest.conditions) {
        if (quest.conditions[c].rank === 4) {
            needGodRank = true;
            break;
        }
    }
    
    for (var i = 0; i < menus.length; i++) {
        var recipe = menus[i].recipe.data;
        if (!recipe) continue;
        
        if (usedRecipeIds.indexOf(recipe.recipeId) >= 0) continue;
        if ($("#chk-cal-got").prop("checked") && !recipe.got) continue;
        if (!checkRecipeMatchQuestConditions(recipe, quest)) continue;
        
        var skillDiffResult = calculateSkillDiffForQuery(chef, recipe, 4);
        
        filteredRecipes.push({
            recipe: recipe,
            recipeId: recipe.recipeId,
            canReachGod: skillDiffResult.value === 0,
            skillDiff: skillDiffResult.value,
            time: recipe.time
        });
    }
    
    if (needGodRank) {
        filteredRecipes.sort(function(a, b) {
            if (a.canReachGod !== b.canReachGod) {
                return a.canReachGod ? -1 : 1;
            }
            if (a.skillDiff !== b.skillDiff) {
                return a.skillDiff - b.skillDiff;
            }
            return a.time - b.time;
        });
    } else {
        filteredRecipes.sort(function(a, b) {
            return a.time - b.time;
        });
    }
    
    return filteredRecipes.map(function(r) { return r.recipe; });
}

/**
 * 检查菜谱是否满足修炼任务条件
 */
function checkRecipeMatchQuestConditions(recipe, quest) {
    if (!quest || !quest.conditions || quest.conditions.length === 0) {
        return false;
    }
    
    var conditions = quest.conditions;
    var matched = false;
    
    for (var o in conditions) {
        var p = true;
        var r = conditions[o];
        
        if (r.recipeId && r.recipeId != recipe.recipeId) p = false;
        
        if (p && r.materialId) {
            var hasMaterial = false;
            for (var u in recipe.materials) {
                if (recipe.materials[u].material == r.materialId) {
                    hasMaterial = true;
                    break;
                }
            }
            if (!hasMaterial) p = false;
        }
        
        if (p && r.guest) {
            if (recipe.guestsVal && recipe.guestsVal.indexOf(r.guest) >= 0) {
            } else if (recipe.rankGuestsVal && recipe.rankGuestsVal.indexOf(r.guest) >= 0) {
            } else {
                p = false;
            }
        }
        
        if (p && (r.anyGuest || r.newGuest)) {
            if (!recipe.guestsVal && !recipe.rankGuestsVal) p = false;
        }
        
        if (p && r.skill && recipe["" + r.skill] == 0) p = false;
        if (p && r.rarity && recipe.rarity < r.rarity) p = false;
        if (p && r.price && recipe.price < r.price) p = false;
        if (p && r.category && !recipe["" + r.category]) p = false;
        if (p && r.condiment && recipe.condiment != r.condiment) p = false;
        
        if (p) {
            matched = true;
            break;
        }
    }
    
    return matched;
}

// ==================== 技法差值计算 ====================

/**
 * 计算厨师做菜谱的详细技法差值（同时返回总差值和各技法差值）
 */
function calculateSkillDiffForQuery(chef, recipe, targetRank, returnDetailed) {
    var totalDiff = 0;
    var detailed = createEmptySkillBonus();
    
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        var skill = SKILL_TYPES[i];
        var recipeNeed = recipe[skill] || 0;
        if (recipeNeed > 0) {
            var diff = getChefSkillVal(chef, skill) - recipeNeed * targetRank;
            detailed[skill] = diff;
            if (diff < 0) totalDiff += Math.abs(diff);
        }
    }
    
    if (returnDetailed) {
        return detailed;
    }
    return { value: totalDiff };
}

/**
 * 计算厨师做菜谱的详细技法差值（兼容旧调用）
 */
function calculateDetailedSkillDiffForQuery(chef, recipe, targetRank) {
    return calculateSkillDiffForQuery(chef, recipe, targetRank, true);
}

// ==================== UI填充 ====================

/**
 * 将查询结果填充到计算器UI
 */
function fillQueryResultToCalUI(result, gameData) {
    var rule = calCustomRule.rules[0];
    var custom = rule.custom;
    
    var savedEquips = [];
    for (var i = 0; i < 3; i++) {
        if (custom[i] && custom[i].equip && custom[i].equip.equipId) {
            savedEquips[i] = custom[i].equip.equipId;
        } else {
            savedEquips[i] = null;
        }
    }
    
    for (var i = 0; i < 3; i++) {
        setCustomChef(0, i, null);
        for (var j = 0; j < 3; j++) {
            setCustomRecipe(0, i, j, null);
        }
    }
    
    for (var i = 0; i < result.positions.length; i++) {
        var pos = result.positions[i];
        
        if (pos.type === "empty") continue;
        
        setCustomChef(0, i, pos.chef.chefId);
        
        if (savedEquips[i]) {
            setCustomEquip(0, i, savedEquips[i]);
        }
        
        if (pos.recipes) {
            for (var j = 0; j < pos.recipes.length && j < 3; j++) {
                setCustomRecipe(0, i, j, pos.recipes[j].recipeId);
            }
        }
        
        if (pos.recommendedEquip) {
            setCustomEquip(0, i, pos.recommendedEquip.equipId);
        }
    }
    
    calCustomResults(gameData);
    
    for (var i = 0; i < result.positions.length; i++) {
        var pos = result.positions[i];
        if (pos.type === "empty" || !pos.recipes || pos.recipes.length <= 1) continue;
        
        var recipesWithRank = [];
        for (var j = 0; j < custom[i].recipes.length; j++) {
            var recipeData = custom[i].recipes[j];
            if (recipeData && recipeData.data) {
                recipesWithRank.push({
                    recipeId: recipeData.data.recipeId,
                    rankVal: recipeData.rankVal || 0,
                    skillDiff: recipeData.skillDiff || 0
                });
            }
        }
        
        recipesWithRank.sort(function(a, b) {
            if (b.rankVal !== a.rankVal) {
                return b.rankVal - a.rankVal;
            }
            return b.skillDiff - a.skillDiff;
        });
        
        var needReorder = false;
        for (var j = 0; j < recipesWithRank.length; j++) {
            if (custom[i].recipes[j] && custom[i].recipes[j].data && 
                custom[i].recipes[j].data.recipeId !== recipesWithRank[j].recipeId) {
                needReorder = true;
                break;
            }
        }
        
        if (needReorder) {
            for (var j = 0; j < 3; j++) {
                setCustomRecipe(0, i, j, null);
            }
            for (var j = 0; j < recipesWithRank.length; j++) {
                setCustomRecipe(0, i, j, recipesWithRank[j].recipeId);
            }
        }
    }
    
    calCustomResults(gameData);
}


// ==================== 厨具相关 ====================

/**
 * 获取厨具的技法加成类型和值（仅固定值加成）
 * 注意：此函数不包含百分比加成，仅用于简单场景
 */
function getEquipSkillBonus(equip) {
    var bonus = createEmptySkillBonus();
    if (!equip || !equip.effect) return bonus;
    
    for (var i = 0; i < equip.effect.length; i++) {
        var effect = equip.effect[i];
        if (effect.condition && effect.condition !== "Self") continue;
        
        var skill = SKILL_EFFECT_MAP[effect.type];
        if (skill && effect.cal !== "Percent") {
            bonus[skill] += effect.value || 0;
        }
    }
    return bonus;
}

/**
 * 获取厨具的最大技法加成值（仅固定值）
 */
function getEquipMaxSkillValue(equip) {
    var bonus = getEquipSkillBonus(equip);
    var max = 0;
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        if (bonus[SKILL_TYPES[i]] > max) max = bonus[SKILL_TYPES[i]];
    }
    return max;
}

/**
 * 判断厨具是否是强力厨具
 * 强力厨具定义：固定值加成>100 或 有百分比类技法加成
 */
function isStrongEquip(equip) {
    if (!equip || !equip.effect) return false;
    
    for (var i = 0; i < equip.effect.length; i++) {
        var effect = equip.effect[i];
        if (effect.condition && effect.condition !== "Self") continue;
        
        var skill = SKILL_EFFECT_MAP[effect.type];
        if (skill) {
            // 百分比加成的厨具是强力厨具
            if (effect.cal === "Percent") {
                return true;
            }
            // 固定值>100的厨具是强力厨具
            if (effect.cal !== "Percent" && (effect.value || 0) > 100) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 判断厨具是否有技法加成
 */
function hasEquipSkillBonus(equip) {
    if (!equip || !equip.effect) return false;
    
    for (var i = 0; i < equip.effect.length; i++) {
        var effect = equip.effect[i];
        if (effect.condition && effect.condition !== "Self") continue;
        
        var skill = SKILL_EFFECT_MAP[effect.type];
        if (skill && (effect.value || 0) > 0) {
            return true;
        }
    }
    return false;
}

/**
 * 获取厨具加成的技法类型列表
 */
function getEquipSkillTypes(equip) {
    var types = [];
    if (!equip || !equip.effect) return types;
    
    for (var i = 0; i < equip.effect.length; i++) {
        var effect = equip.effect[i];
        if (effect.condition && effect.condition !== "Self") continue;
        
        var skill = SKILL_EFFECT_MAP[effect.type];
        if (skill && (effect.value || 0) > 0 && types.indexOf(skill) < 0) {
            types.push(skill);
        }
    }
    return types;
}

/**
 * 获取厨具来源优先级（数字越小优先级越高）
 * 优先级：新手奖池(1) > 实验室(2) > 碧池(3) > 其他(4)
 */
function getEquipOriginPriority(origin) {
    if (!origin) return 4;
    if (origin.indexOf("新手奖池") >= 0) return 1;
    if (origin.indexOf("实验室") >= 0) return 2;
    if (origin.indexOf("碧池") >= 0) return 3;
    return 4;
}

/**
 * 检查厨具是否能使菜谱达到神级（使用setDataForChef正确计算百分比加成）
 * @param baseChef - 原始厨师数据（从rule.chefs中获取）
 * @param recipe - 菜谱
 * @param equip - 厨具对象
 * @param auraChefs - 光环厨师数组（可选）
 * @param rule - 规则对象
 * @param useAmber - 是否使用已配遗玉
 * @returns {boolean} 是否能达到神级
 */
function canEquipMakeRecipeGodWithCalc(baseChef, recipe, equip, auraChefs, rule, useAmber) {
    // 深拷贝厨师数据
    var chef = JSON.parse(JSON.stringify(baseChef));
    
    // 收集光环厨师的修炼技能效果（只收集技法加成类）
    var partialAdds = [];
    if (auraChefs && auraChefs.length > 0) {
        for (var a = 0; a < auraChefs.length; a++) {
            var auraChef = auraChefs[a];
            if (auraChef.chef && auraChef.chef.ultimateSkillEffect) {
                for (var e = 0; e < auraChef.chef.ultimateSkillEffect.length; e++) {
                    var effect = auraChef.chef.ultimateSkillEffect[e];
                    // 只处理技法加成类型
                    var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                    if (!effectSkillType) continue;
                    
                    // 检查条件是否满足
                    if (effect.conditionType === "ChefTag" && effect.conditionValueList) {
                        var targetTags = baseChef.tags || [];
                        var tagMatch = false;
                        for (var t = 0; t < effect.conditionValueList.length; t++) {
                            if (targetTags.indexOf(effect.conditionValueList[t]) >= 0) {
                                tagMatch = true;
                                break;
                            }
                        }
                        if (!tagMatch) continue;
                    }
                    // 只收集对应类型的效果
                    if (auraChef.type === "Next" && effect.condition === "Next") {
                        partialAdds.push(effect);
                    } else if (auraChef.type === "Partial" && effect.condition === "Partial") {
                        partialAdds.push(effect);
                    }
                }
            }
        }
    }
    
    // 使用 setDataForChef 计算技法值（正确处理百分比加成）
    setDataForChef(
        chef,
        equip,
        true,
        rule.calGlobalUltimateData,
        partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        useAmber,
        rule.calQixiaData || null
    );
    
    // 检查是否达到神级
    return calculateSkillDiffForQuery(chef, recipe, 4).value === 0;
}

/**
 * 检查厨具是否能使菜谱达到神级（旧版本，使用简单加法，不支持百分比）
 * @deprecated 请使用 canEquipMakeRecipeGodWithCalc
 * @param chef - 基础厨师（不含厨具加成）
 * @param recipe - 菜谱
 * @param equipBonus - 厨具技法加成对象
 * @param auraChefs - 光环厨师数组（可选）
 */
function canEquipMakeRecipeGod(chef, recipe, equipBonus, auraChefs) {
    // 先应用光环厨师加成（使用正确的计算方式）
    var chefWithAura = chef;
    if (auraChefs && auraChefs.length > 0) {
        // 收集光环厨师的修炼技能效果（只收集技法加成类）
        var partialAdds = [];
        for (var a = 0; a < auraChefs.length; a++) {
            var auraChef = auraChefs[a];
            if (auraChef.chef && auraChef.chef.ultimateSkillEffect) {
                for (var e = 0; e < auraChef.chef.ultimateSkillEffect.length; e++) {
                    var effect = auraChef.chef.ultimateSkillEffect[e];
                    // 只处理技法加成类型
                    var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                    if (!effectSkillType) continue;
                    
                    // 检查条件是否满足
                    if (effect.conditionType === "ChefTag" && effect.conditionValueList) {
                        var targetTags = chef.tags || [];
                        var tagMatch = false;
                        for (var t = 0; t < effect.conditionValueList.length; t++) {
                            if (targetTags.indexOf(effect.conditionValueList[t]) >= 0) {
                                tagMatch = true;
                                break;
                            }
                        }
                        if (!tagMatch) continue;
                    }
                    // 只收集对应类型的效果
                    if (auraChef.type === "Next" && effect.condition === "Next") {
                        partialAdds.push(effect);
                    } else if (auraChef.type === "Partial" && effect.condition === "Partial") {
                        partialAdds.push(effect);
                    }
                }
            }
        }
        chefWithAura = applyAuraEffectsToChef(chef, partialAdds, calCustomRule.rules[0]);
    }
    // 再应用厨具加成（直接加到最终技法值）
    var boostedChef = applySkillBonusToChef(chefWithAura, equipBonus);
    return calculateSkillDiffForQuery(boostedChef, recipe, 4).value === 0;
}

/**
 * 查找能使未达神菜谱达到神级的厨具（通用版本）
 * 排序优先级：来源优先级 > 同来源按厨具ID降序（优先使用新厨具）> 技法加成值升序
 * @param baseChef - 原始厨师数据（从rule.chefs中获取）
 * @param recipes - 菜谱数组
 * @param notGodIndices - 未达神菜谱的索引数组
 * @param auraChefs - 光环厨师数组（可选）
 * @param allEquips - 所有厨具
 * @param useStrongEquip - 是否使用强力厨具
 * @param rule - 规则对象
 * @param useAmber - 是否使用已配遗玉
 */
function findEquipForNotGodRecipes(baseChef, recipes, notGodIndices, auraChefs, allEquips, useStrongEquip, rule, useAmber) {
    if (notGodIndices.length === 0) return null;
    
    // 如果没有传入rule，使用默认规则
    if (!rule) {
        rule = calCustomRule.rules[0];
    }
    // 如果没有传入useAmber，从页面获取
    if (useAmber === undefined) {
        useAmber = $("#chk-cal-use-amber").prop("checked");
    }
    
    var candidateEquips = [];
    for (var i = 0; i < allEquips.length; i++) {
        var equip = allEquips[i];
        
        // 检查是否有技法加成
        if (!hasEquipSkillBonus(equip)) continue;
        
        // 检查是否是强力厨具
        var isStrong = isStrongEquip(equip);
        if (!useStrongEquip && isStrong) continue;
        
        var maxValue = getEquipMaxSkillValue(equip);
        
        candidateEquips.push({
            equip: equip,
            maxValue: maxValue,
            isStrong: isStrong,
            originPriority: getEquipOriginPriority(equip.origin),
            equipId: equip.equipId || 0
        });
    }
    
    // 排序：来源优先级 > 同来源按厨具ID降序 > 技法加成值升序
    candidateEquips.sort(function(a, b) {
        // 1. 来源优先级
        if (a.originPriority !== b.originPriority) {
            return a.originPriority - b.originPriority;
        }
        // 2. 同来源按厨具ID降序（优先使用新厨具）
        if (a.equipId !== b.equipId) {
            return b.equipId - a.equipId;
        }
        // 3. 技法加成值升序（用最小够用的）
        return a.maxValue - b.maxValue;
    });
    
    for (var targetCount = notGodIndices.length; targetCount >= 1; targetCount--) {
        for (var i = 0; i < candidateEquips.length; i++) {
            var candidate = candidateEquips[i];
            var satisfiedCount = 0;
            
            for (var j = 0; j < notGodIndices.length; j++) {
                // 使用新的计算函数，正确处理百分比加成
                if (canEquipMakeRecipeGodWithCalc(baseChef, recipes[notGodIndices[j]], candidate.equip, auraChefs, rule, useAmber)) {
                    satisfiedCount++;
                }
            }
            
            if (satisfiedCount >= targetCount) {
                return {
                    equip: candidate.equip,
                    satisfiedCount: satisfiedCount,
                    totalNotGod: notGodIndices.length
                };
            }
        }
    }
    
    return null;
}

/**
 * 尝试为未达神的菜谱找厨具补足
 * @param baseChef - 原始厨师数据（从rule.chefs中获取）
 * @param recipes - 选中的菜谱
 * @param auraChefs - 光环厨师数组（可选）
 * @param gameData - 游戏数据
 */
function tryFindEquipForNotGodRecipes(baseChef, recipes, auraChefs, gameData) {
    var rule = calCustomRule.rules[0];
    var useStrongEquip = $("#chk-unultimated-use-strong-equip").prop("checked");
    var useAmber = $("#chk-cal-use-amber").prop("checked");
    
    // 先计算不带厨具的厨师技法值来判断哪些菜谱未达神
    var chefForCheck = JSON.parse(JSON.stringify(baseChef));
    
    // 收集光环厨师的修炼技能效果（只收集技法加成类）
    var partialAdds = [];
    if (auraChefs && auraChefs.length > 0) {
        for (var a = 0; a < auraChefs.length; a++) {
            var auraChef = auraChefs[a];
            if (auraChef.chef && auraChef.chef.ultimateSkillEffect) {
                for (var e = 0; e < auraChef.chef.ultimateSkillEffect.length; e++) {
                    var effect = auraChef.chef.ultimateSkillEffect[e];
                    // 只处理技法加成类型
                    var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                    if (!effectSkillType) continue;
                    
                    // 检查条件是否满足
                    if (effect.conditionType === "ChefTag" && effect.conditionValueList) {
                        var targetTags = baseChef.tags || [];
                        var tagMatch = false;
                        for (var t = 0; t < effect.conditionValueList.length; t++) {
                            if (targetTags.indexOf(effect.conditionValueList[t]) >= 0) {
                                tagMatch = true;
                                break;
                            }
                        }
                        if (!tagMatch) continue;
                    }
                    // 只收集对应类型的效果
                    if (auraChef.type === "Next" && effect.condition === "Next") {
                        partialAdds.push(effect);
                    } else if (auraChef.type === "Partial" && effect.condition === "Partial") {
                        partialAdds.push(effect);
                    }
                }
            }
        }
    }
    
    // 使用 setDataForChef 计算不带厨具的技法值
    setDataForChef(
        chefForCheck,
        null, // 不使用厨具
        true,
        rule.calGlobalUltimateData,
        partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        useAmber,
        rule.calQixiaData || null
    );
    
    var notGodIndices = [];
    for (var i = 0; i < recipes.length; i++) {
        var diff = calculateSkillDiffForQuery(chefForCheck, recipes[i], 4);
        if (diff.value > 0) {
            notGodIndices.push(i);
        }
    }
    
    if (notGodIndices.length === 0) {
        return null;
    }
    
    return findEquipForNotGodRecipes(baseChef, recipes, notGodIndices, auraChefs, rule.equips, useStrongEquip, rule, useAmber);
}

/**
 * 为菜谱神级方案查询搜索能使技法达标的厨具
 * @param baseChef - 原始厨师数据（从rule.chefs中获取）
 * @param recipe - 菜谱
 * @param targetSkills - 目标技法值
 * @param partialAdds - 光环加成效果数组
 * @param rule - 规则对象
 * @param useAmber - 是否使用已配遗玉
 * @param useStrongEquip - 是否使用强力厨具
 * @returns {Object|null} { equip, skillValues, deficit } 或 null
 */
function findEquipForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, useAmber, useStrongEquip) {
    var allEquips = rule.equips || [];
    
    // 筛选候选厨具
    var candidateEquips = [];
    for (var i = 0; i < allEquips.length; i++) {
        var equip = allEquips[i];
        
        // 检查是否有技法加成
        if (!hasEquipSkillBonus(equip)) continue;
        
        // 检查是否是强力厨具
        var isStrong = isStrongEquip(equip);
        if (!useStrongEquip && isStrong) continue;
        
        var maxValue = getEquipMaxSkillValue(equip);
        
        candidateEquips.push({
            equip: equip,
            maxValue: maxValue,
            isStrong: isStrong,
            originPriority: getEquipOriginPriority(equip.origin),
            equipId: equip.equipId || 0
        });
    }
    
    // 排序：来源优先级 > 同来源按厨具ID降序 > 技法加成值升序
    candidateEquips.sort(function(a, b) {
        if (a.originPriority !== b.originPriority) {
            return a.originPriority - b.originPriority;
        }
        if (a.equipId !== b.equipId) {
            return b.equipId - a.equipId;
        }
        return a.maxValue - b.maxValue;
    });
    
    var bestResult = null;
    var bestDeficit = Infinity;
    
    for (var i = 0; i < candidateEquips.length; i++) {
        var candidate = candidateEquips[i];
        
        // 深拷贝厨师数据
        var chef = JSON.parse(JSON.stringify(baseChef));
        
        // 如果不使用已配遗玉，清空厨师的遗玉数据
        if (!useAmber && chef.disk && chef.disk.ambers) {
            for (var j = 0; j < chef.disk.ambers.length; j++) {
                chef.disk.ambers[j].data = null;
            }
        }
        
        // 使用 setDataForChef 计算技法值
        setDataForChef(
            chef,
            candidate.equip,
            true,
            rule.calGlobalUltimateData,
            partialAdds && partialAdds.length > 0 ? partialAdds : null,
            rule.calSelfUltimateData,
            rule.calActivityUltimateData,
            true,
            rule,
            useAmber,
            rule.calQixiaData || null
        );
        
        var skillValues = {
            stirfry: chef.stirfryVal || 0,
            boil: chef.boilVal || 0,
            knife: chef.knifeVal || 0,
            fry: chef.fryVal || 0,
            bake: chef.bakeVal || 0,
            steam: chef.steamVal || 0
        };
        
        // 计算差值
        var deficit = 0;
        for (var skill in targetSkills) {
            var target = targetSkills[skill].target;
            var current = skillValues[skill] || 0;
            if (current < target) {
                deficit += (target - current);
            }
        }
        
        // 如果达标，直接返回
        if (deficit === 0) {
            return {
                equip: candidate.equip,
                skillValues: skillValues,
                deficit: 0
            };
        }
        
        // 记录最小差值的结果
        if (deficit < bestDeficit) {
            bestDeficit = deficit;
            bestResult = {
                equip: candidate.equip,
                skillValues: skillValues,
                deficit: deficit
            };
        }
    }
    
    return bestResult;
}

/**
 * 为菜谱神级方案查询搜索能使技法达标的红色遗玉
 * @param baseChef - 原始厨师数据（从rule.chefs中获取）
 * @param recipe - 菜谱
 * @param targetSkills - 目标技法值
 * @param partialAdds - 光环加成效果数组
 * @param rule - 规则对象
 * @param useEquip - 是否使用已配厨具
 * @param maxDisk - 是否使用满级心法盘
 * @returns {Object|null} { amber, slotIndex, skillValues, deficit } 或 null
 */
function findAmberForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, useEquip, maxDisk) {
    // 检查厨师是否有红色心法盘槽位
    if (!baseChef.disk || !baseChef.disk.ambers) return null;
    
    // 收集所有红色槽位索引
    var redSlotIndices = [];
    for (var i = 0; i < baseChef.disk.ambers.length; i++) {
        if (baseChef.disk.ambers[i].type === 1) { // 红色槽位
            redSlotIndices.push(i);
        }
    }
    
    if (redSlotIndices.length === 0) return null;
    
    // 先计算当前差值技法类型
    var chef = JSON.parse(JSON.stringify(baseChef));
    var diskLevel = maxDisk ? (baseChef.disk.maxLevel || baseChef.disk.level || 1) : (baseChef.disk.level || 1);
    chef.disk.level = diskLevel;
    
    // 清空遗玉数据计算基础技法值
    for (var j = 0; j < chef.disk.ambers.length; j++) {
        chef.disk.ambers[j].data = null;
    }
    
    var equipToUse = useEquip ? chef.equip : null;
    setDataForChef(
        chef,
        equipToUse,
        true,
        rule.calGlobalUltimateData,
        partialAdds && partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        false, // 不使用遗玉
        rule.calQixiaData || null
    );
    
    // 找出有差值的技法类型
    var deficitSkills = [];
    var skillTypes = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    for (var i = 0; i < skillTypes.length; i++) {
        var skill = skillTypes[i];
        if (targetSkills[skill]) {
            var target = targetSkills[skill].target;
            var current = chef[skill + 'Val'] || 0;
            if (current < target) {
                deficitSkills.push(skill);
            }
        }
    }
    
    // 如果没有差值，直接返回
    if (deficitSkills.length === 0) {
        return null;
    }

    // 获取所有红色遗玉（只使用三星的，且能补差值技法的）
    var allAmbers = rule.ambers || [];
    var redAmbers = [];
    for (var i = 0; i < allAmbers.length; i++) {
        var amber = allAmbers[i];
        if (amber.type === 1 && amber.rarity === 3) { // 红色遗玉且三星
            // 检查是否能补差值技法
            if (canAmberHelpDeficit(amber, deficitSkills)) {
                redAmbers.push(amber);
            }
        }
    }

    if (redAmbers.length === 0) return null;
    
    var bestResult = null;
    var bestDeficit = Infinity;
    var numSlots = redSlotIndices.length;
    
    // 如果只有一个红色槽位，简单遍历所有遗玉
    if (numSlots === 1) {
        var slotIndex = redSlotIndices[0];
        for (var i = 0; i < redAmbers.length; i++) {
            var amber = redAmbers[i];
            
            // 深拷贝厨师数据
            var chef = JSON.parse(JSON.stringify(baseChef));
            
            // 清空所有遗玉数据（因为不使用已配遗玉）
            for (var j = 0; j < chef.disk.ambers.length; j++) {
                chef.disk.ambers[j].data = null;
            }
            
            // 设置遗玉到红色槽位
            chef.disk.ambers[slotIndex].data = amber;
            chef.disk.level = diskLevel;
            
            // 使用 setDataForChef 计算技法值
            var equipToUse = useEquip ? chef.equip : null;
            setDataForChef(
                chef,
                equipToUse,
                true,
                rule.calGlobalUltimateData,
                partialAdds && partialAdds.length > 0 ? partialAdds : null,
                rule.calSelfUltimateData,
                rule.calActivityUltimateData,
                true,
                rule,
                true, // 使用遗玉
                rule.calQixiaData || null
            );
            
            var skillValues = {
                stirfry: chef.stirfryVal || 0,
                boil: chef.boilVal || 0,
                knife: chef.knifeVal || 0,
                fry: chef.fryVal || 0,
                bake: chef.bakeVal || 0,
                steam: chef.steamVal || 0
            };
            
            // 计算差值
            var deficit = 0;
            for (var skill in targetSkills) {
                var target = targetSkills[skill].target;
                var current = skillValues[skill] || 0;
                if (current < target) {
                    deficit += (target - current);
                }
            }
            
            // 如果达标，直接返回
            if (deficit === 0) {
                return {
                    amber: amber,
                    slotIndex: slotIndex,
                    amberList: [{ amber: amber, slotIndex: slotIndex }],
                    skillValues: skillValues,
                    deficit: 0
                };
            }
            
            // 记录最小差值的结果
            if (deficit < bestDeficit) {
                bestDeficit = deficit;
                bestResult = {
                    amber: amber,
                    slotIndex: slotIndex,
                    amberList: [{ amber: amber, slotIndex: slotIndex }],
                    skillValues: skillValues,
                    deficit: deficit
                };
            }
        }
    } else {
        // 多个红色槽位，所有槽位设置同一种遗玉
        // 遍历所有候选遗玉，找能使差值最小的
        for (var i = 0; i < redAmbers.length; i++) {
            var amber = redAmbers[i];
            
            // 深拷贝厨师数据
            var chef = JSON.parse(JSON.stringify(baseChef));
            
            // 清空所有遗玉数据
            for (var j = 0; j < chef.disk.ambers.length; j++) {
                chef.disk.ambers[j].data = null;
            }
            
            // 所有红色槽位设置同一种遗玉
            var selectedAmbers = [];
            for (var s = 0; s < numSlots; s++) {
                var slotIndex = redSlotIndices[s];
                chef.disk.ambers[slotIndex].data = amber;
                selectedAmbers.push({ amber: amber, slotIndex: slotIndex });
            }
            chef.disk.level = diskLevel;
            
            var equipToUse = useEquip ? chef.equip : null;
            setDataForChef(
                chef,
                equipToUse,
                true,
                rule.calGlobalUltimateData,
                partialAdds && partialAdds.length > 0 ? partialAdds : null,
                rule.calSelfUltimateData,
                rule.calActivityUltimateData,
                true,
                rule,
                true,
                rule.calQixiaData || null
            );
            
            var skillValues = {
                stirfry: chef.stirfryVal || 0,
                boil: chef.boilVal || 0,
                knife: chef.knifeVal || 0,
                fry: chef.fryVal || 0,
                bake: chef.bakeVal || 0,
                steam: chef.steamVal || 0
            };
            
            var deficit = 0;
            for (var skill in targetSkills) {
                var target = targetSkills[skill].target;
                var current = skillValues[skill] || 0;
                if (current < target) {
                    deficit += (target - current);
                }
            }
            
            // 如果达标，直接返回
            if (deficit === 0) {
                return {
                    amber: amber,
                    slotIndex: redSlotIndices[0],
                    amberList: selectedAmbers,
                    skillValues: skillValues,
                    deficit: 0
                };
            }
            
            // 记录最小差值的结果
            if (deficit < bestDeficit) {
                bestDeficit = deficit;
                bestResult = {
                    amber: amber,
                    slotIndex: redSlotIndices[0],
                    amberList: selectedAmbers,
                    skillValues: skillValues,
                    deficit: deficit
                };
            }
        }
    }
    
    return bestResult;
}

/**
 * 获取遗玉加成的技法类型列表
 * @returns {Array} 技法类型列表，如 ['stirfry', 'boil']
 */
function getAmberSkillTypes(amber) {
    if (!amber || !amber.allEffect) return [];
    
    var skillTypeMap = {
        'Stirfry': 'stirfry',
        'Boil': 'boil',
        'Knife': 'knife',
        'Fry': 'fry',
        'Bake': 'bake',
        'Steam': 'steam'
    };
    
    var result = [];
    var added = {};
    
    for (var level = 0; level < amber.allEffect.length; level++) {
        var effects = amber.allEffect[level];
        if (effects) {
            for (var i = 0; i < effects.length; i++) {
                var effect = effects[i];
                if (effect && effect.type && skillTypeMap[effect.type]) {
                    var skillType = skillTypeMap[effect.type];
                    if (!added[skillType]) {
                        added[skillType] = true;
                        result.push(skillType);
                    }
                }
            }
        }
    }
    
    return result;
}

/**
 * 检查遗玉是否能补某种技法的差值
 * @param amber - 遗玉
 * @param deficitSkills - 有差值的技法类型数组，如 ['stirfry', 'fry']
 * @returns {Boolean}
 */
function canAmberHelpDeficit(amber, deficitSkills) {
    var amberSkills = getAmberSkillTypes(amber);
    
    // 检查遗玉的技法类型是否与差值技法匹配
    for (var i = 0; i < deficitSkills.length; i++) {
        if (amberSkills.indexOf(deficitSkills[i]) >= 0) {
            return true;
        }
    }
    
    return false;
}



/**
 * 获取修炼任务剩余需要的份数
 * @param ruleIndex - 规则索引
 * @param chefIndex - 厨师位置索引
 * @param recipeIndex - 当前要设置的菜谱位置索引
 * @param chefId - 厨师ID
 * @returns 剩余需要的份数，如果没有修炼任务要求则返回null
 */
function getQuestRemainingQuantity(ruleIndex, chefIndex, recipeIndex, chefId) {
    
    // 确保recipeIndex是数字
    recipeIndex = Number(recipeIndex);
    
    // 获取厨师的第一个修炼任务
    var quest = getChefFirstUltimateQuestForCultivation(chefId);
    
    if (!quest || !quest.conditions) {
        return null;
    }
    
    // 获取任务要求的份数
    var requiredQuantity = 0;
    for (var c = 0; c < quest.conditions.length; c++) {
        if (quest.conditions[c].num) {
            requiredQuantity = quest.conditions[c].num;
            break;
        }
    }
    
    
    // 如果任务没有份数要求，返回null
    if (requiredQuantity <= 0) {
        return null;
    }
    
    // 计算该厨师已分配的菜谱份数（不包括当前要设置的位置）
    var rule = calCustomRule.rules[ruleIndex];
    if (!rule || !rule.custom || !rule.custom[chefIndex]) {
        return requiredQuantity;
    }
    
    var customData = rule.custom[chefIndex];
    var recipes = customData.recipes || [];
    var allocatedQuantity = 0;
    
    
    for (var i = 0; i < recipes.length; i++) {
        // 跳过当前要设置的位置
        if (i === recipeIndex) {
            continue;
        }
        
        if (recipes[i] && recipes[i].data && recipes[i].quantity > 0) {
            var qty = Number(recipes[i].quantity);
            allocatedQuantity += qty;
        }
    }
    
    
    // 计算剩余需要的份数
    var remaining = requiredQuantity - allocatedQuantity;
    
    // 确保不返回负数
    return Math.max(0, remaining);
}


// ==================== 菜谱神级方案查询 ====================

/**
 * 初始化菜谱神级方案查询下拉框
 */
function initRecipeGodQueryDropdown(gameData) {
    var isCultivateMode = calCustomRule.isCultivate;
    
    if (!isCultivateMode) {
        // 非修炼查询模式，不需要初始化
        return;
    }
    
    // 刷新菜谱列表
    refreshRecipeGodQueryList(gameData);
    
    // 初始化配置
    initRecipeGodConfig();
    
    // 初始化查询按钮事件
    initRecipeGodQueryButton();
    
    // 弹窗显示时移除配置按钮焦点
    $("#recipe-god-config-modal").off("shown.bs.modal").on("shown.bs.modal", function() {
        $("#btn-recipe-god-config").blur();
        // 刷新selectpicker
        $("#select-recipe-god-grade").selectpicker("refresh");
    });
}

/**
 * 初始化菜谱神级方案查询配置
 */
function initRecipeGodConfig() {
    var localData = getLocalData();
    var config = localData.recipeGodConfig || {};
    
    // 设置开关状态
    if (config.useStrongEquip) {
        $("#chk-recipe-god-use-strong-equip").bootstrapToggle("on");
    } else {
        $("#chk-recipe-god-use-strong-equip").bootstrapToggle("off");
    }
    
    // 设置品级下拉框
    if (config.grade) {
        $("#select-recipe-god-grade").selectpicker("val", config.grade);
    } else {
        $("#select-recipe-god-grade").selectpicker("val", "4"); // 默认神级
    }
    
    // 监听开关变化，保存到本地存储
    $("#chk-recipe-god-use-strong-equip").off("change").on("change", function() {
        saveRecipeGodConfig();
    });
    
    // 监听品级下拉框变化
    $("#select-recipe-god-grade").off("changed.bs.select").on("changed.bs.select", function() {
        saveRecipeGodConfig();
        // 重新计算差值显示
        if (typeof calCustomResults === 'function') {
            calCustomResults();
        }
    });
}

/**
 * 保存菜谱神级方案查询配置
 */
function saveRecipeGodConfig() {
    var config = {
        useStrongEquip: $("#chk-recipe-god-use-strong-equip").prop("checked"),
        grade: $("#select-recipe-god-grade").val()
    };
    updateLocalData("recipeGodConfig", config);
}

/**
 * 刷新菜谱神级方案查询列表
 * 单选模式，显示星级（星星图标）和技法值，按最高技法值降序排序
 */
function refreshRecipeGodQueryList(gameData) {
    var rule = calCustomRule.rules[0];
    if (!rule || !rule.recipes) return;
    
    var gotChecked = $("#chk-cal-got").prop("checked");
    
    // 获取当前已选中的菜谱ID
    var selectedId = $("#select-cal-recipe-god-query").val();
    
    var list = [];
    
    for (var i = 0; i < rule.recipes.length; i++) {
        var recipe = rule.recipes[i];
        
        // 勾选已有时，只显示已有菜谱
        if (gotChecked && !recipe.got) continue;
        
        // 计算最高技法值
        var maxSkillValue = Math.max(
            recipe.stirfry || 0,
            recipe.boil || 0,
            recipe.knife || 0,
            recipe.fry || 0,
            recipe.bake || 0,
            recipe.steam || 0
        );
        
        // 构建技法显示（参考getSkillDisp函数格式）
        var skillDisp = "";
        if (recipe.stirfry) skillDisp += "<span>炒" + recipe.stirfry + "</span>";
        if (recipe.boil) skillDisp += "<span>煮" + recipe.boil + "</span>";
        if (recipe.knife) skillDisp += "<span>切" + recipe.knife + "</span>";
        if (recipe.fry) skillDisp += "<span>炸" + recipe.fry + "</span>";
        if (recipe.bake) skillDisp += "<span>烤" + recipe.bake + "</span>";
        if (recipe.steam) skillDisp += "<span>蒸" + recipe.steam + "</span>";
        
        // 使用getRarityDisp生成星星图标
        var rarityDisp = getRarityDisp(recipe.rarity);
        
        list.push({
            recipeId: recipe.recipeId,
            name: recipe.name,
            rarity: recipe.rarity,
            maxSkillValue: maxSkillValue,
            skillDisp: skillDisp,
            rarityDisp: rarityDisp
        });
    }
    
    // 按最高技法值降序排序
    list.sort(function(a, b) {
        return b.maxSkillValue - a.maxSkillValue;
    });
    
    // 构建选项HTML（添加隐藏的空选项作为默认值）
    var html = '<option value="" selected class="hidden"></option>';
    for (var i = 0; i < list.length; i++) {
        var item = list[i];
        // 格式：菜谱名 + 星级（星星图标） + 技法值
        var displayContent = "<span class='name'>" + item.name + "</span>" +
            "<span class='subtext'>" + item.rarityDisp + "</span>" +
            "<span class='skilltext'>" + item.skillDisp + "</span>";
        html += '<option value="' + item.recipeId + '" data-content="' + displayContent.replace(/"/g, '&quot;') + '">' + item.name + '</option>';
    }
    
    // 更新下拉框
    $("#select-cal-recipe-god-query").html(html).selectpicker("refresh");
    
    // 恢复选中状态
    if (selectedId) {
        $("#select-cal-recipe-god-query").selectpicker("val", selectedId);
    }
}


// ==================== 菜谱神级方案查询 - 厨师过滤 ====================

/**
 * 菜谱神级方案查询 - 主函数
 */
function queryRecipeGodPlan() {
    
    // 先清空场上已选
    clearAllSelectedOnField(cultivationGameData);
    
    // 1. 获取选中的菜谱
    var selectedRecipeId = $("#select-cal-recipe-god-query").val();
    if (!selectedRecipeId) {
        return;
    }
    
    // 2. 获取配置
    var config = getRecipeGodQueryConfig();
    
    // 3. 获取菜谱数据
    var rule = calCustomRule.rules[0];
    if (!rule || !rule.recipes) {
        return;
    }
    
    var recipe = null;
    for (var i = 0; i < rule.recipes.length; i++) {
        if (String(rule.recipes[i].recipeId) === String(selectedRecipeId)) {
            recipe = rule.recipes[i];
            break;
        }
    }
    
    if (!recipe) {
        return;
    }
    
    // 4. 计算目标品级需要的技法值
    var targetSkills = calculateTargetSkills(recipe, config.grade);
    
    // 5. 过滤厨师
    var filteredChefs = filterChefsForRecipeGod(rule.chefs, recipe, targetSkills, config);
    
    // 6. 检查是否有差值为0的厨师，直接设置到页面
    if (filteredChefs.length > 0 && filteredChefs[0]._totalDeficit === 0) {
        var bestChef = filteredChefs[0];
        
        // 设置厨师和菜谱到页面第一个位置
        setRecipeGodResultToPage(bestChef, recipe, rule);
        
        return;
    }
    
    // 7. 没有差值为0的厨师，查找光环厨师来补差值
    
    if (filteredChefs.length === 0) {
        alert("没有找到能做该菜谱的厨师");
        return;
    }
    
    // 获取最佳厨师的差值信息
    var bestChef = filteredChefs[0];
    var deficits = bestChef._deficits || {};
    var deficitSkills = []; // 有差值的技法类型
    for (var skill in deficits) {
        if (deficits[skill] > 0) {
            deficitSkills.push(skill);
        }
    }
    
    
    // 查找光环厨师
    var auraResult = findAuraChefsForRecipeGod(rule.chefs, deficitSkills, bestChef);
    
    // 打印Partial厨师名字
    var partialChefNames = {};
    for (var skill in auraResult.partialChefsBySkill) {
        partialChefNames[skill] = auraResult.partialChefsBySkill[skill].map(function(c) {
            return c.chef.name + "(+" + c.value + ")";
        });
    }
    
    // 8. 计算每个候选厨师与光环厨师组合后的差值
    // 缓存差值最小的前5个组合
    var topCombinations = []; // 存储前5名组合
    var TOP_N = 5;
    
    // 辅助函数：将组合插入到topCombinations中（保持按差值升序排序，最多保留TOP_N个）
    function insertTopCombination(combination) {
        // 找到插入位置
        var insertIndex = topCombinations.length;
        for (var ti = 0; ti < topCombinations.length; ti++) {
            if (combination.deficit < topCombinations[ti].deficit) {
                insertIndex = ti;
                break;
            }
        }
        // 插入
        topCombinations.splice(insertIndex, 0, combination);
        // 保留前TOP_N个
        if (topCombinations.length > TOP_N) {
            topCombinations.pop();
        }
    }
    
    // 获取配置
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    var useAmber = $("#chk-cal-use-amber").prop("checked");
    var maxDisk = $("#chk-cal-max-disk").prop("checked");
    
    // 第一遍：只使用Next厨师计算（不进行厨具遗玉分配）
    if (auraResult.nextChef) {
        
        for (var i = 0; i < filteredChefs.length; i++) {
            // 如果候选厨师就是Next厨师，跳过
            if (filteredChefs[i].chefId === auraResult.nextChef.chefId) {
                continue;
            }
            
            // 深拷贝厨师数据
            var originalChef = null;
            for (var ci = 0; ci < rule.chefs.length; ci++) {
                if (rule.chefs[ci].chefId === filteredChefs[i].chefId) {
                    originalChef = rule.chefs[ci];
                    break;
                }
            }
            if (!originalChef) continue;
            
            // 构造光环加成数组（Next厨师的修炼技能，只收集技法加成类）
            // Next厨师的Next效果应用到紧邻的下一位厨师
            // Next厨师的Partial效果也应用到所有后续厨师
            var partialAdds = [];
            if (auraResult.nextChef.ultimateSkillEffect) {
                for (var k = 0; k < auraResult.nextChef.ultimateSkillEffect.length; k++) {
                    var effect = auraResult.nextChef.ultimateSkillEffect[k];
                    // 只处理技法加成类型
                    var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                    if (!effectSkillType) continue;
                    
                    if (effect.condition === 'Next' || effect.condition === 'Partial') {
                        partialAdds.push(effect);
                    }
                }
            }
            
            // 计算技法值（不进行厨具遗玉搜索）
            var chef = JSON.parse(JSON.stringify(originalChef));
            var equipToUse = useEquip ? chef.equip : null;
            
            if (maxDisk && chef.disk) {
                chef.disk.level = chef.disk.maxLevel || chef.disk.level || 1;
            }
            
            // 如果不使用已配遗玉，清空遗玉数据
            if (!useAmber && chef.disk && chef.disk.ambers) {
                for (var j = 0; j < chef.disk.ambers.length; j++) {
                    chef.disk.ambers[j].data = null;
                }
            }
            
            setDataForChef(
                chef,
                equipToUse,
                true,
                rule.calGlobalUltimateData,
                partialAdds.length > 0 ? partialAdds : null,
                rule.calSelfUltimateData,
                rule.calActivityUltimateData,
                true,
                rule,
                useAmber,
                rule.calQixiaData || null
            );
            
            var newSkillValues = {
                stirfry: chef.stirfryVal || 0,
                boil: chef.boilVal || 0,
                knife: chef.knifeVal || 0,
                fry: chef.fryVal || 0,
                bake: chef.bakeVal || 0,
                steam: chef.steamVal || 0
            };
            
            var newDeficit = 0;
            for (var skill in targetSkills) {
                var target = targetSkills[skill].target;
                var current = newSkillValues[skill] || 0;
                if (current < target) {
                    newDeficit += (target - current);
                }
            }
            
            // 缓存到前5名组合
            insertTopCombination({
                chef: filteredChefs[i],
                auraChefs: [auraResult.nextChef],
                useNext: true,
                skillValues: newSkillValues,
                deficit: newDeficit,
                recommendedEquip: null,
                recommendedAmber: null,
                recommendedAmberList: null
            });
            
            // 如果差值为0，立即停止并设置组合
            if (newDeficit === 0) {
                printFinalCombinationSkills(filteredChefs[i], newSkillValues, targetSkills);
                setRecipeGodResultToPageWithAura(filteredChefs[i], recipe, rule, [auraResult.nextChef], true, null, null);
                return;
            }
        }
    }
    
    // 第二遍：生成所有2个光环厨师的组合（只能上场3个厨师：1候选+最多2光环）
    
    // 收集所有光环厨师（去重）
    var allAuraChefs = [];
    var addedAuraIds = {};
    
    // 添加Next厨师
    if (auraResult.nextChef && !addedAuraIds[auraResult.nextChef.chefId]) {
        addedAuraIds[auraResult.nextChef.chefId] = true;
        allAuraChefs.push({
            chef: auraResult.nextChef,
            skill: auraResult.nextSkill,
            value: auraResult.nextValue,
            isNext: true
        });
    }
    
    // 添加Partial厨师
    for (var skill in auraResult.partialChefsBySkill) {
        var skillChefs = auraResult.partialChefsBySkill[skill];
        for (var j = 0; j < skillChefs.length; j++) {
            var pc = skillChefs[j];
            if (!addedAuraIds[pc.chef.chefId]) {
                addedAuraIds[pc.chef.chefId] = true;
                allAuraChefs.push({
                    chef: pc.chef,
                    skill: pc.skill,
                    value: pc.value,
                    isNext: false
                });
            }
        }
    }
    
    // 添加特殊光环厨师
    for (var j = 0; j < auraResult.specialAuraChefs.length; j++) {
        var sc = auraResult.specialAuraChefs[j];
        if (!addedAuraIds[sc.chef.chefId]) {
            addedAuraIds[sc.chef.chefId] = true;
            allAuraChefs.push({
                chef: sc.chef,
                skill: sc.skill,
                value: sc.value,
                isNext: false,
                isSpecial: true,
                conditionValueList: sc.conditionValueList
            });
        }
    }
    
    
    // 生成所有2个光环厨师的组合
    var auraCombinations = [];
    for (var i = 0; i < allAuraChefs.length; i++) {
        for (var j = i + 1; j < allAuraChefs.length; j++) {
            auraCombinations.push([allAuraChefs[i], allAuraChefs[j]]);
        }
    }
    // 也包括只有1个光环厨师的情况
    for (var i = 0; i < allAuraChefs.length; i++) {
        auraCombinations.push([allAuraChefs[i]]);
    }
    
    
    // 遍历每个候选厨师和每个光环组合
    for (var i = 0; i < filteredChefs.length; i++) {
        var chefTags = filteredChefs[i].tags || [];
        var candidateChefId = filteredChefs[i].chefId;
        
        for (var c = 0; c < auraCombinations.length; c++) {
            var auraComb = auraCombinations[c];
            
            // 收集有效的光环厨师和构造partialAdds
            var partialAdds = [];
            var usedAuraChefs = [];
            var hasNext = false;
            
            // 记录需要替补的技法类型
            var needReplacementSkills = [];
            
            for (var a = 0; a < auraComb.length; a++) {
                var aura = auraComb[a];
                
                // 如果候选厨师与光环厨师相同，记录需要替补的技法类型
                if (aura.chef.chefId === candidateChefId) {
                    needReplacementSkills.push({
                        skill: aura.skill,
                        isNext: aura.isNext,
                        isSpecial: aura.isSpecial || false,
                        conditionValueList: aura.conditionValueList
                    });
                    continue;
                }
                
                // 特殊光环厨师需要检查tags匹配
                if (aura.isSpecial) {
                    var tagMatch = false;
                    for (var k = 0; k < aura.conditionValueList.length; k++) {
                        if (chefTags.indexOf(aura.conditionValueList[k]) >= 0) {
                            tagMatch = true;
                            break;
                        }
                    }
                    if (!tagMatch) continue; // 不匹配则跳过该光环厨师
                }
                
                usedAuraChefs.push(aura.chef);
                if (aura.isNext) hasNext = true;
                
                // 收集该光环厨师的修炼技能效果（只收集技法加成类）
                if (aura.chef.ultimateSkillEffect) {
                    for (var k = 0; k < aura.chef.ultimateSkillEffect.length; k++) {
                        var effect = aura.chef.ultimateSkillEffect[k];
                        // 只处理技法加成类型
                        var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                        if (!effectSkillType) continue;
                        
                        if (aura.isNext && effect.condition === 'Next') {
                            partialAdds.push(effect);
                        }
                        if (effect.condition === 'Partial') {
                            partialAdds.push(effect);
                        }
                    }
                }
            }
            
            // 如果候选厨师自己是光环厨师，需要找替补
            if (needReplacementSkills.length > 0) {
                for (var r = 0; r < needReplacementSkills.length; r++) {
                    var replaceInfo = needReplacementSkills[r];
                    var replacementFound = false;
                    
                    // 从同类技法的光环厨师列表中找替补
                    if (replaceInfo.isNext) {
                        // Next厨师替补：暂不处理，因为Next厨师只有1个
                    } else if (!replaceInfo.isSpecial) {
                        // Partial厨师替补：从 auraResult.partialChefsBySkill 中找
                        var skillChefs = auraResult.partialChefsBySkill[replaceInfo.skill] || [];
                        for (var sc = 0; sc < skillChefs.length; sc++) {
                            var replacement = skillChefs[sc];
                            // 排除候选厨师自己和已使用的光环厨师
                            if (replacement.chef.chefId === candidateChefId) continue;
                            var alreadyUsed = false;
                            for (var u = 0; u < usedAuraChefs.length; u++) {
                                if (usedAuraChefs[u].chefId === replacement.chef.chefId) {
                                    alreadyUsed = true;
                                    break;
                                }
                            }
                            if (alreadyUsed) continue;
                            
                            // 找到替补
                            usedAuraChefs.push(replacement.chef);
                            if (replacement.chef.ultimateSkillEffect) {
                                for (var k = 0; k < replacement.chef.ultimateSkillEffect.length; k++) {
                                    var effect = replacement.chef.ultimateSkillEffect[k];
                                    // 只处理技法加成类型
                                    var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                                    if (!effectSkillType) continue;
                                    
                                    if (effect.condition === 'Partial') {
                                        partialAdds.push(effect);
                                    }
                                }
                            }
                            replacementFound = true;
                            break;
                        }
                    }
                }
            }
            
            // 如果没有有效的光环厨师，跳过
            if (usedAuraChefs.length === 0) continue;
            
            // 深拷贝厨师数据
            var originalChef = null;
            for (var ci = 0; ci < rule.chefs.length; ci++) {
                if (rule.chefs[ci].chefId === filteredChefs[i].chefId) {
                    originalChef = rule.chefs[ci];
                    break;
                }
            }
            if (!originalChef) continue;
            
            // 检查目标厨师自己是否有 Partial 效果（如果目标厨师也是 Partial 厨师）
            // calCustomResults 中的 getPartialChefAdds 会收集所有 Partial 厨师的效果，包括目标厨师自己
            // 所以这里也需要把目标厨师自己的 Partial 效果加入到 partialAdds 中
            // 但是只有当目标厨师在 calPartialChefIds 中时才添加（即被勾选为"上场类已修炼"）
            var calPartialChefIds = rule.calPartialChefIds || [];
            var targetChefId = filteredChefs[i].chefId;
            var isTargetInPartialList = calPartialChefIds.indexOf(targetChefId) >= 0;
            
            // 只有当目标厨师在 calPartialChefIds 中时才添加她自己的 Partial 效果
            if (isTargetInPartialList) {
                // 优先使用 filteredChefs[i] 的 ultimateSkillEffect，因为 originalChef 可能没有这个属性
                var chefSkillEffect = filteredChefs[i].ultimateSkillEffect || originalChef.ultimateSkillEffect;
                if (chefSkillEffect) {
                    for (var ek = 0; ek < chefSkillEffect.length; ek++) {
                        var selfEffect = chefSkillEffect[ek];
                        if (selfEffect.condition === 'Partial') {
                            partialAdds.push(selfEffect);
                        }
                    }
                }
            } 
            // 尝试搜索厨具或遗玉来补差值
            var searchResult = tryFindEquipOrAmberForRecipeGod(
                originalChef, recipe, targetSkills, partialAdds, rule,
                useEquip, useAmber, config.useStrongEquip, maxDisk
            );
            
            var newSkillValues = searchResult.skillValues;
            var newDeficit = searchResult.deficit;
        
            // 缓存到前5名组合
            insertTopCombination({
                chef: filteredChefs[i],
                auraChefs: usedAuraChefs,
                useNext: hasNext,
                skillValues: newSkillValues,
                deficit: newDeficit,
                recommendedEquip: searchResult.recommendedEquip,
                recommendedAmber: searchResult.recommendedAmber,
                recommendedAmberList: searchResult.recommendedAmberList
            });
            
            // 如果差值为0，立即停止并设置组合
            if (newDeficit === 0) {
                printFinalCombinationSkills(filteredChefs[i], newSkillValues, targetSkills);
                setRecipeGodResultToPageWithAura(filteredChefs[i], recipe, rule, usedAuraChefs, hasNext, searchResult.recommendedEquip, searchResult.recommendedAmber, searchResult.recommendedAmberList);
                return;
            }
        }
    }
    
    // 9. 没有达标的组合，对前5名进行心法盘替换优化
    
    var reachedCombinations = []; // 达标的组合
    var bestOptimizedCombination = null; // 差值最小的优化后组合
    
    for (var ti = 0; ti < topCombinations.length; ti++) {
        var candidate = topCombinations[ti];
        
        // 尝试心法盘替换优化
        var optimizedResult = tryOptimizeAmberReplacement(
            candidate, recipe, targetSkills, rule, config
        );
        
        var finalResult = optimizedResult || candidate;
        
        // 检查是否达标
        if (finalResult.deficit === 0) {
            reachedCombinations.push(finalResult);
        }
        
        // 更新差值最小的组合
        if (!bestOptimizedCombination || finalResult.deficit < bestOptimizedCombination.deficit) {
            bestOptimizedCombination = finalResult;
        }
    }
    
    // 10. 选择最终结果
    var bestCombination = null;
    
    if (reachedCombinations.length > 0) {
        // 有达标的组合，选择应用心法盘和厨具最少的
        
        // 计算每个组合使用的心法盘和厨具数量
        for (var ri = 0; ri < reachedCombinations.length; ri++) {
            var rc = reachedCombinations[ri];
            var amberCount = rc.recommendedAmberList ? rc.recommendedAmberList.length : 0;
            var equipCount = rc.recommendedEquip ? 1 : 0;
            rc._resourceCount = amberCount + equipCount;
        }
        
        // 按资源数量升序排序
        reachedCombinations.sort(function(a, b) {
            return a._resourceCount - b._resourceCount;
        });
        
        bestCombination = reachedCombinations[0];
    } else if (bestOptimizedCombination) {
        // 没有达标的组合，使用差值最小的
        bestCombination = bestOptimizedCombination;
    } else if (topCombinations.length > 0) {
        // 使用原始的差值最小组合
        bestCombination = topCombinations[0];
    }
    
    // 11. 设置最终结果到页面
    if (bestCombination) {
        printFinalCombinationSkills(bestCombination.chef, bestCombination.skillValues, targetSkills);
        setRecipeGodResultToPageWithAura(bestCombination.chef, recipe, rule, bestCombination.auraChefs, bestCombination.useNext, bestCombination.recommendedEquip, bestCombination.recommendedAmber, bestCombination.recommendedAmberList);
        
        // 如果仍未达标，弹窗提示
        if (bestCombination.deficit > 0) {
            var gradeName = GRADE_NAMES_SHORT[config.grade] || '神';
            var deficitMsg = "查询菜谱无法达到" + gradeName + "级，";
            var deficitParts = [];
            for (var skill in targetSkills) {
                var target = targetSkills[skill].target;
                var current = bestCombination.skillValues[skill] || 0;
                var diff = current - target;
                if (diff < 0) {
                    deficitParts.push(SKILL_NAMES[skill] + "技法" + diff);
                }
            }
            deficitMsg += deficitParts.join("，") + "，可调整配置后重新查询";
            showAlert(deficitMsg);
        }
    } else {
        showAlert("没有找到能做该菜谱的厨师");
    }
    
}

/**
 * 尝试心法盘替换优化
 * 当最终组合无法达到神级时，根据差值类型替换心法盘遗玉，重新计算
 * 例如：当前使用3个蒸心法盘，差值为炒-40，则逐一替换蒸为炒，重新计算
 * @param {Object} bestCombination - 当前最佳组合
 * @param {Object} recipe - 菜谱
 * @param {Object} targetSkills - 目标技法值
 * @param {Object} rule - 规则对象
 * @param {Object} config - 配置
 * @returns {Object|null} 优化后的组合，如果无法优化则返回null
 */
function tryOptimizeAmberReplacement(bestCombination, recipe, targetSkills, rule, config) {
    
    // 检查配置
    var useAmber = $("#chk-cal-use-amber").prop("checked");
    var useEquipConfig = $("#chk-cal-use-equip").prop("checked");
    var maxDisk = $("#chk-cal-max-disk").prop("checked");
    var useStrongEquip = config.useStrongEquip;
    
    // 确定优化顺序
    // 都没勾选 + 开启强力厨具 → 厨具 → 心法盘 → 光环
    // 都没勾选 + 未开启强力厨具 → 心法盘 → 厨具 → 光环
    // 勾选已配厨具 → 跳过厨具，心法盘 → 光环
    // 勾选已配遗玉 → 跳过心法盘，厨具 → 光环
    var skipAmberOpt = useAmber;
    var skipEquipOpt = useEquipConfig;
    var equipFirst = !useAmber && !useEquipConfig && useStrongEquip;
    
    
    
    
    // 获取当前差值的技法类型
    var deficitSkills = [];
    
    for (var skill in targetSkills) {
        var target = targetSkills[skill].target;
        var current = bestCombination.skillValues[skill] || 0;
        if (current < target) {
            deficitSkills.push({ skill: skill, deficit: target - current });
        }
    }
    
    if (deficitSkills.length === 0) {
        return null;
    }
    
    // 按差值降序排序
    deficitSkills.sort(function(a, b) { return b.deficit - a.deficit; });
    
    // 获取当前已设置的心法盘遗玉类型
    var currentAmberList = bestCombination.recommendedAmberList || [];
    var skipAmberReplacement = useAmber; // 如果勾选了已配遗玉，跳过心法盘替换
    
    if (currentAmberList.length === 0) {
        skipAmberReplacement = true;
    }
    
    // 获取差值技法类型（提前定义，供后面使用）
    var deficitSkillTypes = deficitSkills.map(function(d) { return d.skill; });
    
    // 分析当前心法盘的技法类型
    var currentAmberSkills = [];
    var needReplacement = false;
    var replaceableAmbers = []; // 可以被替换的心法盘（技法类型与差值不同）
    
    if (currentAmberList.length > 0 && !useAmber) {
        for (var i = 0; i < currentAmberList.length; i++) {
            var amber = currentAmberList[i].amber;
            if (amber) {
                var amberSkills = getAmberSkillTypes(amber);
                currentAmberSkills.push({
                    index: i,
                    slotIndex: currentAmberList[i].slotIndex,
                    amber: amber,
                    skills: amberSkills
                });
            }
        }
        
        // 检查当前心法盘技法是否与差值技法不同
        for (var i = 0; i < currentAmberSkills.length; i++) {
            var amberInfo = currentAmberSkills[i];
            var hasDeficitSkill = false;
            for (var j = 0; j < amberInfo.skills.length; j++) {
                if (deficitSkillTypes.indexOf(amberInfo.skills[j]) >= 0) {
                    hasDeficitSkill = true;
                    break;
                }
            }
            if (!hasDeficitSkill) {
                // 这个心法盘的技法类型与差值技法不同，可以被替换
                replaceableAmbers.push(amberInfo);
                needReplacement = true;
            }
        }
        
        if (!needReplacement) {
            skipAmberReplacement = true;
        }
    }
    
    // 更新skipAmberReplacement
    if (!skipAmberReplacement && !needReplacement) {
        skipAmberReplacement = true;
    }
    if (skipAmberReplacement) {
        if (useAmber) {
        }
    } else {
    }
    
    // 获取差值技法类型的三星红色遗玉
    var allAmbers = rule.ambers || [];
    var deficitAmbers = {}; // { stirfry: [amber1, amber2], ... }
    
    for (var i = 0; i < allAmbers.length; i++) {
        var amber = allAmbers[i];
        if (amber.type === 1 && amber.rarity === 3) {
            var amberSkills = getAmberSkillTypes(amber);
            for (var j = 0; j < deficitSkillTypes.length; j++) {
                var deficitSkill = deficitSkillTypes[j];
                if (amberSkills.indexOf(deficitSkill) >= 0) {
                    if (!deficitAmbers[deficitSkill]) deficitAmbers[deficitSkill] = [];
                    deficitAmbers[deficitSkill].push(amber);
                }
            }
        }
    }
    
    // 检查是否有可用的差值技法遗玉
    var primaryDeficitSkill = deficitSkills[0].skill;
    var replacementAmbers = deficitAmbers[primaryDeficitSkill] || [];
    
    if (replacementAmbers.length === 0 && !skipAmberReplacement) {
        // 不直接返回，继续尝试厨具和光环优化
        skipAmberReplacement = true;
    }
    
    if (!skipAmberReplacement) {
    }
    
    // 获取原始厨师数据
    var originalChef = null;
    for (var ci = 0; ci < rule.chefs.length; ci++) {
        if (rule.chefs[ci].chefId === bestCombination.chef.chefId) {
            originalChef = rule.chefs[ci];
            break;
        }
    }
    
    if (!originalChef) {
        return null;
    }
    
    // 构造光环加成数组（只收集技法加成类）
    var partialAdds = [];
    for (var a = 0; a < bestCombination.auraChefs.length; a++) {
        var auraChef = bestCombination.auraChefs[a];
        if (auraChef.ultimateSkillEffect) {
            for (var k = 0; k < auraChef.ultimateSkillEffect.length; k++) {
                var effect = auraChef.ultimateSkillEffect[k];
                // 只处理技法加成类型
                var effectSkillType = SKILL_EFFECT_MAP[effect.type];
                if (!effectSkillType) continue;
                
                if (effect.condition === 'Next' || effect.condition === 'Partial') {
                    partialAdds.push(effect);
                }
            }
        }
    }
    
    var bestOptimizedResult = null;
    var bestOptimizedDeficit = bestCombination.deficit;
    var replacementAmber = replacementAmbers.length > 0 ? replacementAmbers[0] : null; // 使用第一个差值技法遗玉
    
    // 确定优化顺序：开启强力厨具且都没勾选时，厨具优先
    var equipFirst = !useAmber && !useEquipConfig && config.useStrongEquip;
    
    // 确定循环次数：如果跳过心法盘替换，只执行一次（使用当前配置）
    var maxReplaceCount = skipAmberReplacement ? 0 : replaceableAmbers.length;
    
    // ========== 厨具优先模式：先搜索厨具 ==========
    if (equipFirst && !useEquipConfig) {
        var diskLevel = maxDisk ? (originalChef.disk.maxLevel || originalChef.disk.level || 1) : (originalChef.disk.level || 1);
        
        var newDeficitSkillsForEquip = deficitSkillTypes;
        var allEquips = rule.equips || [];
        var candidateEquips = [];
        
        for (var i = 0; i < allEquips.length; i++) {
            var equip = allEquips[i];
            if (!hasEquipSkillBonus(equip)) continue;
            var isStrong = isStrongEquip(equip);
            if (!config.useStrongEquip && isStrong) continue;
            
            var equipSkills = getEquipSkillTypes(equip);
            var canHelp = false;
            for (var j = 0; j < newDeficitSkillsForEquip.length; j++) {
                if (equipSkills.indexOf(newDeficitSkillsForEquip[j]) >= 0) {
                    canHelp = true;
                    break;
                }
            }
            if (canHelp) {
                candidateEquips.push(equip);
            }
        }
        
        
        for (var e = 0; e < candidateEquips.length; e++) {
            var equip = candidateEquips[e];
            
            var chefWithEquip = JSON.parse(JSON.stringify(originalChef));
            chefWithEquip.disk.level = diskLevel;
            
            for (var j = 0; j < chefWithEquip.disk.ambers.length; j++) {
                chefWithEquip.disk.ambers[j].data = null;
            }
            
            for (var k = 0; k < currentAmberList.length; k++) {
                if (currentAmberList[k] && currentAmberList[k].slotIndex !== undefined) {
                    chefWithEquip.disk.ambers[currentAmberList[k].slotIndex].data = currentAmberList[k].amber;
                }
            }
            
            setDataForChef(
                chefWithEquip, equip, true, rule.calGlobalUltimateData,
                partialAdds.length > 0 ? partialAdds : null,
                rule.calSelfUltimateData, rule.calActivityUltimateData,
                true, rule, true, rule.calQixiaData || null
            );
            
            var equipSkillValues = {
                stirfry: chefWithEquip.stirfryVal || 0,
                boil: chefWithEquip.boilVal || 0,
                knife: chefWithEquip.knifeVal || 0,
                fry: chefWithEquip.fryVal || 0,
                bake: chefWithEquip.bakeVal || 0,
                steam: chefWithEquip.steamVal || 0
            };
            
            var equipDeficit = 0;
            for (var skill in targetSkills) {
                var target = targetSkills[skill].target;
                var current = equipSkillValues[skill] || 0;
                if (current < target) {
                    equipDeficit += (target - current);
                }
            }
            
            if (equipDeficit === 0) {
                return {
                    chef: bestCombination.chef,
                    auraChefs: bestCombination.auraChefs,
                    useNext: bestCombination.useNext,
                    skillValues: equipSkillValues,
                    deficit: 0,
                    recommendedEquip: equip,
                    recommendedAmber: null,
                    recommendedAmberList: currentAmberList
                };
            }
            
            if (equipDeficit < bestOptimizedDeficit) {
                bestOptimizedDeficit = equipDeficit;
                bestOptimizedResult = {
                    chef: bestCombination.chef,
                    auraChefs: bestCombination.auraChefs,
                    useNext: bestCombination.useNext,
                    skillValues: equipSkillValues,
                    deficit: equipDeficit,
                    recommendedEquip: equip,
                    recommendedAmber: null,
                    recommendedAmberList: currentAmberList
                };
            }
        }
        
    }
    
    // 逐一替换心法盘，计算新差值（如果skipAmberReplacement为true，则只执行一次使用当前配置）
    for (var replaceCount = 0; replaceCount <= maxReplaceCount; replaceCount++) {
        // replaceCount=0 表示不替换心法盘，使用当前配置
        if (replaceCount === 0) {
            if (!skipAmberReplacement) continue; // 如果不跳过心法盘替换，从replaceCount=1开始
        } else {
        }
        
        // 构造新的心法盘列表
        var newAmberList = [];
        for (var i = 0; i < currentAmberList.length; i++) {
            newAmberList.push({
                amber: currentAmberList[i].amber,
                slotIndex: currentAmberList[i].slotIndex
            });
        }
        
        // 替换前replaceCount个可替换的心法盘（如果replaceCount > 0）
        if (replaceCount > 0 && replacementAmber) {
            for (var r = 0; r < replaceCount && r < replaceableAmbers.length; r++) {
                var replaceInfo = replaceableAmbers[r];
                // 在newAmberList中找到对应的项并替换
                for (var n = 0; n < newAmberList.length; n++) {
                    if (newAmberList[n].slotIndex === replaceInfo.slotIndex) {
                        newAmberList[n].amber = replacementAmber;
                        break;
                    }
                }
            }
        }
        
        if (replaceCount > 0) {
        }
        
        // 计算新配置的差值
        var diskLevel = maxDisk ? (originalChef.disk.maxLevel || originalChef.disk.level || 1) : (originalChef.disk.level || 1);
        
        var chefTest = JSON.parse(JSON.stringify(originalChef));
        chefTest.disk.level = diskLevel;
        
        // 清空所有遗玉数据
        for (var j = 0; j < chefTest.disk.ambers.length; j++) {
            chefTest.disk.ambers[j].data = null;
        }
        
        // 设置新的遗玉配置
        for (var k = 0; k < newAmberList.length; k++) {
            chefTest.disk.ambers[newAmberList[k].slotIndex].data = newAmberList[k].amber;
        }
        
        // 先不使用厨具计算
        setDataForChef(
            chefTest,
            null,
            true,
            rule.calGlobalUltimateData,
            partialAdds.length > 0 ? partialAdds : null,
            rule.calSelfUltimateData,
            rule.calActivityUltimateData,
            true,
            rule,
            true,
            rule.calQixiaData || null
        );
        
        // 计算新差值
        var newDeficitList = [];
        var skillTypes = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
        for (var i = 0; i < skillTypes.length; i++) {
            var skill = skillTypes[i];
            if (targetSkills[skill]) {
                var target = targetSkills[skill].target;
                var current = chefTest[skill + 'Val'] || 0;
                if (current < target) {
                    newDeficitList.push({ skill: skill, deficit: target - current });
                }
            }
        }
        
        var newDeficit = 0;
        for (var i = 0; i < newDeficitList.length; i++) {
            newDeficit += newDeficitList[i].deficit;
        }
        
        var newSkillValues = {
            stirfry: chefTest.stirfryVal || 0,
            boil: chefTest.boilVal || 0,
            knife: chefTest.knifeVal || 0,
            fry: chefTest.fryVal || 0,
            bake: chefTest.bakeVal || 0,
            steam: chefTest.steamVal || 0
        };
        
        // 如果已经达标
        if (newDeficit === 0) {
            return {
                chef: bestCombination.chef,
                auraChefs: bestCombination.auraChefs,
                useNext: bestCombination.useNext,
                skillValues: newSkillValues,
                deficit: 0,
                recommendedEquip: null,
                recommendedAmber: replaceCount > 0 ? replacementAmber : null,
                recommendedAmberList: replaceCount > 0 ? newAmberList : null
            };
        }
        
        // 尝试搜索厨具补差值
        // 检查是否勾选了已配厨具，如果勾选则跳过厨具搜索
        if (useEquipConfig) {
            // 直接进入光环厨师替换流程
        } else {
        var newDeficitSkills = newDeficitList.map(function(d) { return d.skill; });
        var allEquips = rule.equips || [];
        var candidateEquips = [];
        
        for (var i = 0; i < allEquips.length; i++) {
            var equip = allEquips[i];
            if (!hasEquipSkillBonus(equip)) continue;
            var isStrong = isStrongEquip(equip);
            if (!config.useStrongEquip && isStrong) continue;
            
            var equipSkills = getEquipSkillTypes(equip);
            var canHelp = false;
            for (var j = 0; j < newDeficitSkills.length; j++) {
                if (equipSkills.indexOf(newDeficitSkills[j]) >= 0) {
                    canHelp = true;
                    break;
                }
            }
            if (canHelp) {
                candidateEquips.push(equip);
            }
        }
        
        // 遍历厨具找最佳
        for (var e = 0; e < candidateEquips.length; e++) {
            var equip = candidateEquips[e];
            
            var chefWithEquip = JSON.parse(JSON.stringify(originalChef));
            chefWithEquip.disk.level = diskLevel;
            
            for (var j = 0; j < chefWithEquip.disk.ambers.length; j++) {
                chefWithEquip.disk.ambers[j].data = null;
            }
            
            for (var k = 0; k < newAmberList.length; k++) {
                chefWithEquip.disk.ambers[newAmberList[k].slotIndex].data = newAmberList[k].amber;
            }
            
            setDataForChef(
                chefWithEquip,
                equip,
                true,
                rule.calGlobalUltimateData,
                partialAdds.length > 0 ? partialAdds : null,
                rule.calSelfUltimateData,
                rule.calActivityUltimateData,
                true,
                rule,
                true,
                rule.calQixiaData || null
            );
            
            var equipSkillValues = {
                stirfry: chefWithEquip.stirfryVal || 0,
                boil: chefWithEquip.boilVal || 0,
                knife: chefWithEquip.knifeVal || 0,
                fry: chefWithEquip.fryVal || 0,
                bake: chefWithEquip.bakeVal || 0,
                steam: chefWithEquip.steamVal || 0
            };
            
            var equipDeficit = 0;
            for (var skill in targetSkills) {
                var target = targetSkills[skill].target;
                var current = equipSkillValues[skill] || 0;
                if (current < target) {
                    equipDeficit += (target - current);
                }
            }
            
            if (equipDeficit === 0) {
                return {
                    chef: bestCombination.chef,
                    auraChefs: bestCombination.auraChefs,
                    useNext: bestCombination.useNext,
                    skillValues: equipSkillValues,
                    deficit: 0,
                    recommendedEquip: equip,
                    recommendedAmber: replaceCount > 0 ? replacementAmber : null,
                    recommendedAmberList: replaceCount > 0 ? newAmberList : null
                };
            }
            
            if (equipDeficit < bestOptimizedDeficit) {
                bestOptimizedDeficit = equipDeficit;
                bestOptimizedResult = {
                    chef: bestCombination.chef,
                    auraChefs: bestCombination.auraChefs,
                    useNext: bestCombination.useNext,
                    skillValues: equipSkillValues,
                    deficit: equipDeficit,
                    recommendedEquip: equip,
                    recommendedAmber: replaceCount > 0 ? replacementAmber : null,
                    recommendedAmberList: replaceCount > 0 ? newAmberList : null
                };
            }
        }
        } // 结束 useEquip else 块
        
        // 如果厨具搜索后仍未达标，尝试替换光环厨师
        if (bestOptimizedDeficit > 0) {
            
            // 获取当前差值技法类型
            var currentDeficitSkills = [];
            for (var skill in targetSkills) {
                var target = targetSkills[skill].target;
                var current = bestOptimizedResult ? bestOptimizedResult.skillValues[skill] : newSkillValues[skill];
                if (current < target) {
                    currentDeficitSkills.push(skill);
                }
            }
            
            // 查找能补差值的光环厨师
            var auraResult = findAuraChefsForRecipeGod(rule.chefs, currentDeficitSkills, bestCombination.chef);
            
            // 收集所有可用的光环厨师（排除当前已使用的）
            var currentAuraChefIds = bestCombination.auraChefs.map(function(c) { return c.chefId; });
            var availableAuraChefs = [];
            
            // 添加Partial厨师
            for (var skill in auraResult.partialChefsBySkill) {
                var skillChefs = auraResult.partialChefsBySkill[skill];
                for (var j = 0; j < skillChefs.length; j++) {
                    var pc = skillChefs[j];
                    if (currentAuraChefIds.indexOf(pc.chef.chefId) < 0 && 
                        pc.chef.chefId !== bestCombination.chef.chefId) {
                        availableAuraChefs.push(pc);
                    }
                }
            }
            
            // 添加特殊光环厨师
            for (var j = 0; j < auraResult.specialAuraChefs.length; j++) {
                var sc = auraResult.specialAuraChefs[j];
                if (currentAuraChefIds.indexOf(sc.chef.chefId) < 0 && 
                    sc.chef.chefId !== bestCombination.chef.chefId) {
                    availableAuraChefs.push(sc);
                }
            }
            
            // 尝试替换光环厨师
            for (var ai = 0; ai < availableAuraChefs.length; ai++) {
                var newAuraChef = availableAuraChefs[ai];
                
                // 构造新的光环厨师列表（替换第一个光环厨师）
                var newAuraChefs = [];
                if (bestCombination.auraChefs.length > 0) {
                    // 替换第一个光环厨师
                    newAuraChefs.push(newAuraChef.chef);
                    for (var ac = 1; ac < bestCombination.auraChefs.length; ac++) {
                        newAuraChefs.push(bestCombination.auraChefs[ac]);
                    }
                } else {
                    newAuraChefs.push(newAuraChef.chef);
                }
                
                // 构造新的光环加成数组
                var newPartialAdds = [];
                for (var ac = 0; ac < newAuraChefs.length; ac++) {
                    var aChef = newAuraChefs[ac];
                    if (aChef.ultimateSkillEffect) {
                        for (var ek = 0; ek < aChef.ultimateSkillEffect.length; ek++) {
                            var eff = aChef.ultimateSkillEffect[ek];
                            if (eff.condition === 'Next' || eff.condition === 'Partial') {
                                newPartialAdds.push(eff);
                            }
                        }
                    }
                }
                
                // 使用当前最佳的厨具和心法盘配置重新计算
                var chefWithNewAura = JSON.parse(JSON.stringify(originalChef));
                chefWithNewAura.disk.level = diskLevel;
                
                for (var j = 0; j < chefWithNewAura.disk.ambers.length; j++) {
                    chefWithNewAura.disk.ambers[j].data = null;
                }
                
                for (var k = 0; k < newAmberList.length; k++) {
                    chefWithNewAura.disk.ambers[newAmberList[k].slotIndex].data = newAmberList[k].amber;
                }
                
                var equipToUse = bestOptimizedResult ? bestOptimizedResult.recommendedEquip : null;
                
                setDataForChef(
                    chefWithNewAura,
                    equipToUse,
                    true,
                    rule.calGlobalUltimateData,
                    newPartialAdds.length > 0 ? newPartialAdds : null,
                    rule.calSelfUltimateData,
                    rule.calActivityUltimateData,
                    true,
                    rule,
                    true,
                    rule.calQixiaData || null
                );
                
                var auraSkillValues = {
                    stirfry: chefWithNewAura.stirfryVal || 0,
                    boil: chefWithNewAura.boilVal || 0,
                    knife: chefWithNewAura.knifeVal || 0,
                    fry: chefWithNewAura.fryVal || 0,
                    bake: chefWithNewAura.bakeVal || 0,
                    steam: chefWithNewAura.steamVal || 0
                };
                
                var auraDeficit = 0;
                for (var skill in targetSkills) {
                    var target = targetSkills[skill].target;
                    var current = auraSkillValues[skill] || 0;
                    if (current < target) {
                        auraDeficit += (target - current);
                    }
                }
                
                
                if (auraDeficit === 0) {
                    return {
                        chef: bestCombination.chef,
                        auraChefs: newAuraChefs,
                        useNext: bestCombination.useNext,
                        skillValues: auraSkillValues,
                        deficit: 0,
                        recommendedEquip: equipToUse,
                        recommendedAmber: replaceCount > 0 ? replacementAmber : null,
                        recommendedAmberList: replaceCount > 0 ? newAmberList : null
                    };
                }
                
                if (auraDeficit < bestOptimizedDeficit) {
                    bestOptimizedDeficit = auraDeficit;
                    bestOptimizedResult = {
                        chef: bestCombination.chef,
                        auraChefs: newAuraChefs,
                        useNext: bestCombination.useNext,
                        skillValues: auraSkillValues,
                        deficit: auraDeficit,
                        recommendedEquip: equipToUse,
                        recommendedAmber: replaceCount > 0 ? replacementAmber : null,
                        recommendedAmberList: replaceCount > 0 ? newAmberList : null
                    };
                }
            }
        }
        
        // 如果没有厨具能帮助，也记录只替换心法盘的结果
        if (newDeficit < bestOptimizedDeficit) {
            bestOptimizedDeficit = newDeficit;
            bestOptimizedResult = {
                chef: bestCombination.chef,
                auraChefs: bestCombination.auraChefs,
                useNext: bestCombination.useNext,
                skillValues: newSkillValues,
                deficit: newDeficit,
                recommendedEquip: null,
                recommendedAmber: replacementAmber,
                recommendedAmberList: newAmberList
            };
        }
    }
    
    return bestOptimizedResult;
}

/**
 * 尝试搜索厨具或遗玉来补差值
 * @param baseChef - 原始厨师数据
 * @param recipe - 菜谱
 * @param targetSkills - 目标技法值
 * @param partialAdds - 光环加成效果数组
 * @param rule - 规则对象
 * @param useEquip - 是否使用已配厨具
 * @param useAmber - 是否使用已配遗玉
 * @param useStrongEquip - 是否使用强力厨具
 * @param maxDisk - 是否使用满级心法盘
 * @returns {Object} { skillValues, deficit, recommendedEquip, recommendedAmber, recommendedAmberList }
 */
function tryFindEquipOrAmberForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, useEquip, useAmber, useStrongEquip, maxDisk) {
    var result = {
        skillValues: null,
        deficit: Infinity,
        recommendedEquip: null,
        recommendedAmber: null,
        recommendedAmberList: null
    };
    // 先计算当前技法值和差值
    var chef = JSON.parse(JSON.stringify(baseChef));
    var equipToUse = useEquip ? chef.equip : null;
    
    // 处理默认满级心法盘
    if (maxDisk && chef.disk) {
        chef.disk.level = chef.disk.maxLevel || chef.disk.level || 1;
    }
    
    // 如果不使用已配遗玉，清空厨师的遗玉数据
    if (!useAmber && chef.disk && chef.disk.ambers) {
        for (var i = 0; i < chef.disk.ambers.length; i++) {
            chef.disk.ambers[i].data = null;
        }
    }
    
    setDataForChef(
        chef,
        equipToUse,
        true,
        rule.calGlobalUltimateData,
        partialAdds && partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        useAmber,
        rule.calQixiaData || null
    );
    
    var currentSkillValues = {
        stirfry: chef.stirfryVal || 0,
        boil: chef.boilVal || 0,
        knife: chef.knifeVal || 0,
        fry: chef.fryVal || 0,
        bake: chef.bakeVal || 0,
        steam: chef.steamVal || 0
    };
    
    var currentDeficit = 0;
    for (var skill in targetSkills) {
        var target = targetSkills[skill].target;
        var current = currentSkillValues[skill] || 0;
        if (current < target) {
            currentDeficit += (target - current);
        }
    }

    result.skillValues = currentSkillValues;
    result.deficit = currentDeficit;
    
    // 如果已经达标，直接返回
    if (currentDeficit === 0) {
        return result;
    }
    
    // 情况1：勾选已配遗玉，没勾选已配厨具 → 搜索厨具
    if (useAmber && !useEquip) {
        var equipResult = findEquipForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, true, useStrongEquip);
        if (equipResult && equipResult.deficit < result.deficit) {
            result.skillValues = equipResult.skillValues;
            result.deficit = equipResult.deficit;
            result.recommendedEquip = equipResult.equip;
        }
    }
    
    // 情况2：勾选已配厨具，没勾选已配遗玉 → 搜索红色遗玉
    if (useEquip && !useAmber) {
        var amberResult = findAmberForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, true, maxDisk);
        if (amberResult && amberResult.deficit < result.deficit) {
            result.skillValues = amberResult.skillValues;
            result.deficit = amberResult.deficit;
            result.recommendedAmber = amberResult.amber;
            result.recommendedAmberSlot = amberResult.slotIndex;
            result.recommendedAmberList = amberResult.amberList;
        }
    }
    
    // 情况3：都没勾选 → 根据是否开启使用强力厨具判断搜索顺序
    if (!useEquip && !useAmber) {
        if (useStrongEquip) {
            // 开启了使用强力厨具：先查找厨具，再设置遗玉
            var equipFirstResult = findEquipThenAmberForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, useStrongEquip, maxDisk);
            if (equipFirstResult && equipFirstResult.deficit < result.deficit) {
                result.skillValues = equipFirstResult.skillValues;
                result.deficit = equipFirstResult.deficit;
                result.recommendedEquip = equipFirstResult.equip;
                result.recommendedAmber = equipFirstResult.amber;
                result.recommendedAmberSlot = equipFirstResult.amberSlotIndex;
                result.recommendedAmberList = equipFirstResult.amberList;
            }
        } else {
            // 没开启使用强力厨具：先设置遗玉，再查找厨具
            var amberFirstResult = findEquipAndAmberForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, useStrongEquip, maxDisk);
            if (amberFirstResult && amberFirstResult.deficit < result.deficit) {
                result.skillValues = amberFirstResult.skillValues;
                result.deficit = amberFirstResult.deficit;
                result.recommendedEquip = amberFirstResult.equip;
                result.recommendedAmber = amberFirstResult.amber;
                result.recommendedAmberSlot = amberFirstResult.amberSlotIndex;
                result.recommendedAmberList = amberFirstResult.amberList;
            }
        }
    }
    
    return result;
}

/**
 * 先查找厨具，再设置遗玉的组合（开启使用强力厨具时使用）
 * 逻辑：
 * 1. 先查找能使差值最小的厨具
 * 2. 根据新差值设置遗玉
 */
function findEquipThenAmberForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, useStrongEquip, maxDisk) {
    // 只打印李清凝的详细日志

    var diskLevel = maxDisk ? (baseChef.disk.maxLevel || baseChef.disk.level || 1) : (baseChef.disk.level || 1);

    // 先计算差值技法类型（不使用厨具和遗玉）
    var chef = JSON.parse(JSON.stringify(baseChef));
    chef.disk.level = diskLevel;
    
    // 清空遗玉数据
    if (chef.disk && chef.disk.ambers) {
        for (var j = 0; j < chef.disk.ambers.length; j++) {
            chef.disk.ambers[j].data = null;
        }
    }
    
    setDataForChef(
        chef,
        null,
        true,
        rule.calGlobalUltimateData,
        partialAdds && partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        false,
        rule.calQixiaData || null
    );
    
    // 找出有差值的技法类型
    var deficitSkills = [];
    var skillTypes = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    for (var i = 0; i < skillTypes.length; i++) {
        var skill = skillTypes[i];
        if (targetSkills[skill]) {
            var target = targetSkills[skill].target;
            var current = chef[skill + 'Val'] || 0;
            if (current < target) {
                deficitSkills.push(skill);
            }
        }
    }
    
    if (deficitSkills.length === 0) return null;
    
    // 获取候选厨具（能补差值技法的）
    var allEquips = rule.equips || [];
    var candidateEquips = [];
    
    for (var i = 0; i < allEquips.length; i++) {
        var equip = allEquips[i];
        if (!hasEquipSkillBonus(equip)) continue;
        var isStrong = isStrongEquip(equip);
        if (!useStrongEquip && isStrong) continue;
        
        var equipSkills = getEquipSkillTypes(equip);
        var canHelp = false;
        for (var j = 0; j < deficitSkills.length; j++) {
            if (equipSkills.indexOf(deficitSkills[j]) >= 0) {
                canHelp = true;
                break;
            }
        }
        if (canHelp) {
            candidateEquips.push(equip);
        }
    }
    
    if (candidateEquips.length === 0) return null;
    
    // 找差值最小的厨具
    var bestEquip = null;
    var bestEquipDeficit = Infinity;
    var bestEquipSkillValues = null;
    var bestEquipDeficitList = [];
    
    for (var e = 0; e < candidateEquips.length; e++) {
        var equip = candidateEquips[e];
        
        var chefTest = JSON.parse(JSON.stringify(baseChef));
        chefTest.disk.level = diskLevel;
        
        if (chefTest.disk && chefTest.disk.ambers) {
            for (var j = 0; j < chefTest.disk.ambers.length; j++) {
                chefTest.disk.ambers[j].data = null;
            }
        }
        
        setDataForChef(
            chefTest,
            equip,
            true,
            rule.calGlobalUltimateData,
            partialAdds && partialAdds.length > 0 ? partialAdds : null,
            rule.calSelfUltimateData,
            rule.calActivityUltimateData,
            true,
            rule,
            false,
            rule.calQixiaData || null
        );
        
        var skillValues = {
            stirfry: chefTest.stirfryVal || 0,
            boil: chefTest.boilVal || 0,
            knife: chefTest.knifeVal || 0,
            fry: chefTest.fryVal || 0,
            bake: chefTest.bakeVal || 0,
            steam: chefTest.steamVal || 0
        };
        
        var deficit = 0;
        var deficitList = [];
        for (var skill in targetSkills) {
            var target = targetSkills[skill].target;
            var current = skillValues[skill] || 0;
            if (current < target) {
                deficit += (target - current);
                deficitList.push({ skill: skill, deficit: target - current });
            }
        }
        
        if (deficit < bestEquipDeficit) {
            bestEquipDeficit = deficit;
            bestEquip = equip;
            bestEquipSkillValues = skillValues;
            bestEquipDeficitList = deficitList;
        }
        
        // 如果达标，直接返回
        if (deficit === 0) {
            return {
                equip: equip,
                amber: null,
                amberSlotIndex: -1,
                amberList: null,
                skillValues: skillValues,
                deficit: 0
            };
        }
    }
    
    // 如果厨具已经使差值为0，直接返回
    if (bestEquipDeficit === 0) {
        return {
            equip: bestEquip,
            amber: null,
            amberSlotIndex: -1,
            amberList: null,
            skillValues: bestEquipSkillValues,
            deficit: 0
        };
    }
    
    // 检查厨师是否有红色心法盘槽位
    if (!baseChef.disk || !baseChef.disk.ambers) {
        return {
            equip: bestEquip,
            amber: null,
            amberSlotIndex: -1,
            amberList: null,
            skillValues: bestEquipSkillValues,
            deficit: bestEquipDeficit
        };
    }
    
    var redSlotIndices = [];
    for (var i = 0; i < baseChef.disk.ambers.length; i++) {
        if (baseChef.disk.ambers[i].type === 1) {
            redSlotIndices.push(i);
        }
    }
    
    if (redSlotIndices.length === 0) {
        return {
            equip: bestEquip,
            amber: null,
            amberSlotIndex: -1,
            amberList: null,
            skillValues: bestEquipSkillValues,
            deficit: bestEquipDeficit
        };
    }
    
    // 根据新差值设置遗玉
    // 按差值降序排序
    bestEquipDeficitList.sort(function(a, b) { return b.deficit - a.deficit; });
    
    var newDeficitSkills = bestEquipDeficitList.map(function(d) { return d.skill; });
    
    // 获取所有三星红色遗玉，按技法类型分组
    var allAmbers = rule.ambers || [];
    var ambersBySkill = {};
    
    for (var i = 0; i < allAmbers.length; i++) {
        var amber = allAmbers[i];
        if (amber.type === 1 && amber.rarity === 3) {
            var amberSkills = getAmberSkillTypes(amber);
            for (var j = 0; j < amberSkills.length; j++) {
                var sk = amberSkills[j];
                if (!ambersBySkill[sk]) ambersBySkill[sk] = [];
                ambersBySkill[sk].push(amber);
            }
        }
    }
    
    // 选择差值最大技法类型的遗玉
    var primarySkill = newDeficitSkills.length > 0 ? newDeficitSkills[0] : null;
    var primaryAmbers = primarySkill ? (ambersBySkill[primarySkill] || []) : [];
    
    if (primaryAmbers.length === 0) {
        return {
            equip: bestEquip,
            amber: null,
            amberSlotIndex: -1,
            amberList: null,
            skillValues: bestEquipSkillValues,
            deficit: bestEquipDeficit
        };
    }
    
    // 所有红色槽位设置同一种遗玉
    var selectedAmber = primaryAmbers[0];
    var selectedAmbers = [];
    
    for (var s = 0; s < redSlotIndices.length; s++) {
        var slotIndex = redSlotIndices[s];
        selectedAmbers.push({ amber: selectedAmber, slotIndex: slotIndex });
    }

    // 计算最终结果
    var chefFinal = JSON.parse(JSON.stringify(baseChef));
    chefFinal.disk.level = diskLevel;
    
    for (var j = 0; j < chefFinal.disk.ambers.length; j++) {
        chefFinal.disk.ambers[j].data = null;
    }
    
    for (var k = 0; k < selectedAmbers.length; k++) {
        chefFinal.disk.ambers[selectedAmbers[k].slotIndex].data = selectedAmbers[k].amber;
    }
    
    setDataForChef(
        chefFinal,
        bestEquip,
        true,
        rule.calGlobalUltimateData,
        partialAdds && partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        true,
        rule.calQixiaData || null
    );
    
    var finalSkillValues = {
        stirfry: chefFinal.stirfryVal || 0,
        boil: chefFinal.boilVal || 0,
        knife: chefFinal.knifeVal || 0,
        fry: chefFinal.fryVal || 0,
        bake: chefFinal.bakeVal || 0,
        steam: chefFinal.steamVal || 0
    };
    
    var finalDeficit = 0;
    for (var skill in targetSkills) {
        var target = targetSkills[skill].target;
        var current = finalSkillValues[skill] || 0;
        if (current < target) {
            finalDeficit += (target - current);
        }
    }
    
    return {
        equip: bestEquip,
        amber: selectedAmber,
        amberSlotIndex: redSlotIndices[0],
        amberList: selectedAmbers,
        skillValues: finalSkillValues,
        deficit: finalDeficit
    };
}

/**
 * 同时搜索厨具和遗玉的组合
 * 逻辑：先设置遗玉，再查找厨具
 * - 单技法差值：所有红色位置设置该技法加成的三星红色遗玉
 * - 双技法差值：所有红色位置优先设置差值较大的技法类型的遗玉
 */
function findEquipAndAmberForRecipeGod(baseChef, recipe, targetSkills, partialAdds, rule, useStrongEquip, maxDisk) {
    // 检查厨师是否有红色心法盘槽位
    if (!baseChef.disk || !baseChef.disk.ambers) return null;
    
    // 收集所有红色槽位索引
    var redSlotIndices = [];
    for (var i = 0; i < baseChef.disk.ambers.length; i++) {
        if (baseChef.disk.ambers[i].type === 1) {
            redSlotIndices.push(i);
        }
    }
    
    if (redSlotIndices.length === 0) return null;
    
    var diskLevel = maxDisk ? (baseChef.disk.maxLevel || baseChef.disk.level || 1) : (baseChef.disk.level || 1);
    
    // 先计算差值技法类型和差值大小（不使用厨具和遗玉）
    var chef = JSON.parse(JSON.stringify(baseChef));
    chef.disk.level = diskLevel;
    
    // 清空遗玉数据
    for (var j = 0; j < chef.disk.ambers.length; j++) {
        chef.disk.ambers[j].data = null;
    }

    setDataForChef(
        chef,
        null, // 不使用厨具
        true,
        rule.calGlobalUltimateData,
        partialAdds && partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        false, // 不使用遗玉
        rule.calQixiaData || null
    );
    

    // 找出有差值的技法类型及差值大小，按差值降序排序
    var deficitList = [];
    var skillTypes = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    for (var i = 0; i < skillTypes.length; i++) {
        var skill = skillTypes[i];
        if (targetSkills[skill]) {
            var target = targetSkills[skill].target;
            var current = chef[skill + 'Val'] || 0;
            if (current < target) {
                deficitList.push({ skill: skill, deficit: target - current });
            }
        }
    }
    
    if (deficitList.length === 0) return null;
    
    // 按差值降序排序
    deficitList.sort(function(a, b) { return b.deficit - a.deficit; });
    
    // 获取所有三星红色遗玉，按技法类型分组
    var allAmbers = rule.ambers || [];
    var ambersBySkill = {}; // { stirfry: [amber1, amber2], fry: [amber3] }
    
    for (var i = 0; i < allAmbers.length; i++) {
        var amber = allAmbers[i];
        if (amber.type === 1 && amber.rarity === 3) {
            var amberSkills = getAmberSkillTypes(amber);
            for (var j = 0; j < amberSkills.length; j++) {
                var sk = amberSkills[j];
                if (!ambersBySkill[sk]) ambersBySkill[sk] = [];
                ambersBySkill[sk].push(amber);
            }
        }
    }
    
    // 确定要使用的遗玉技法类型（优先差值最大的）
    var primarySkill = deficitList[0].skill;
    var primaryAmbers = ambersBySkill[primarySkill] || [];
    
    if (primaryAmbers.length === 0) {
        return null;
    }
    
    // 选择第一个该技法的遗玉，所有红色槽位都设置同一种遗玉
    var selectedAmber = primaryAmbers[0];
    var selectedAmbers = [];
 
    // 检查遗玉是否有allEffect属性
    if (!selectedAmber.allEffect) {
    } else {
    }
    
    for (var s = 0; s < redSlotIndices.length; s++) {
        var slotIndex = redSlotIndices[s];
        selectedAmbers.push({ amber: selectedAmber, slotIndex: slotIndex });
    }
    
    // 设置遗玉后重新计算差值
    var chefWithAmber = JSON.parse(JSON.stringify(baseChef));
    chefWithAmber.disk.level = diskLevel;
    
    // 清空所有遗玉数据
    for (var j = 0; j < chefWithAmber.disk.ambers.length; j++) {
        chefWithAmber.disk.ambers[j].data = null;
    }
    
    // 设置选择的遗玉
    for (var k = 0; k < selectedAmbers.length; k++) {
        chefWithAmber.disk.ambers[selectedAmbers[k].slotIndex].data = selectedAmbers[k].amber;
    }
    
    setDataForChef(
        chefWithAmber,
        null, // 不使用厨具
        true,
        rule.calGlobalUltimateData,
        partialAdds && partialAdds.length > 0 ? partialAdds : null,
        rule.calSelfUltimateData,
        rule.calActivityUltimateData,
        true,
        rule,
        true, // 使用遗玉
        rule.calQixiaData || null
    );
 
    // 计算设置遗玉后的新差值
    var newDeficitList = [];
    var skillTypes = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    for (var i = 0; i < skillTypes.length; i++) {
        var skill = skillTypes[i];
        if (targetSkills[skill]) {
            var target = targetSkills[skill].target;
            var current = chefWithAmber[skill + 'Val'] || 0;
            if (current < target) {
                newDeficitList.push({ skill: skill, deficit: target - current });
            }
        }
    }
    
    // 如果已经达标，返回只使用遗玉的结果
    if (newDeficitList.length === 0) {
        var skillValues = {
            stirfry: chefWithAmber.stirfryVal || 0,
            boil: chefWithAmber.boilVal || 0,
            knife: chefWithAmber.knifeVal || 0,
            fry: chefWithAmber.fryVal || 0,
            bake: chefWithAmber.bakeVal || 0,
            steam: chefWithAmber.steamVal || 0
        };
        return {
            equip: null,
            amber: selectedAmbers[0] ? selectedAmbers[0].amber : null,
            amberSlotIndex: selectedAmbers[0] ? selectedAmbers[0].slotIndex : -1,
            amberList: selectedAmbers,
            skillValues: skillValues,
            deficit: 0
        };
    }
    
    // 获取候选厨具（能补新差值的）
    var newDeficitSkills = newDeficitList.map(function(d) { return d.skill; });
    var allEquips = rule.equips || [];
    var candidateEquips = [];
    
    for (var i = 0; i < allEquips.length; i++) {
        var equip = allEquips[i];
        if (!hasEquipSkillBonus(equip)) continue;
        var isStrong = isStrongEquip(equip);
        if (!useStrongEquip && isStrong) continue;
        
        // 检查厨具是否能补新差值的技法
        var equipSkills = getEquipSkillTypes(equip);
        var canHelp = false;
        for (var j = 0; j < newDeficitSkills.length; j++) {
            if (equipSkills.indexOf(newDeficitSkills[j]) >= 0) {
                canHelp = true;
                break;
            }
        }
        if (canHelp) {
            candidateEquips.push(equip);
        }
    }

    // 遍历厨具，找能使差值最小的
    var bestResult = null;
    var bestDeficit = Infinity;
    
    // 先计算只使用遗玉的差值
    var amberOnlyDeficit = 0;
    for (var i = 0; i < newDeficitList.length; i++) {
        amberOnlyDeficit += newDeficitList[i].deficit;
    }
    
    var amberOnlySkillValues = {
        stirfry: chefWithAmber.stirfryVal || 0,
        boil: chefWithAmber.boilVal || 0,
        knife: chefWithAmber.knifeVal || 0,
        fry: chefWithAmber.fryVal || 0,
        bake: chefWithAmber.bakeVal || 0,
        steam: chefWithAmber.steamVal || 0
    };
    
    bestDeficit = amberOnlyDeficit;
    bestResult = {
        equip: null,
        amber: selectedAmbers[0] ? selectedAmbers[0].amber : null,
        amberSlotIndex: selectedAmbers[0] ? selectedAmbers[0].slotIndex : -1,
        amberList: selectedAmbers,
        skillValues: amberOnlySkillValues,
        deficit: amberOnlyDeficit
    };
    
    for (var e = 0; e < candidateEquips.length; e++) {
        var equip = candidateEquips[e];
        
        var chefTest = JSON.parse(JSON.stringify(baseChef));
        chefTest.disk.level = diskLevel;
        
        // 清空所有遗玉数据
        for (var j = 0; j < chefTest.disk.ambers.length; j++) {
            chefTest.disk.ambers[j].data = null;
        }
        
        // 设置选择的遗玉
        for (var k = 0; k < selectedAmbers.length; k++) {
            chefTest.disk.ambers[selectedAmbers[k].slotIndex].data = selectedAmbers[k].amber;
        }
        
        setDataForChef(
            chefTest,
            equip,
            true,
            rule.calGlobalUltimateData,
            partialAdds && partialAdds.length > 0 ? partialAdds : null,
            rule.calSelfUltimateData,
            rule.calActivityUltimateData,
            true,
            rule,
            true,
            rule.calQixiaData || null
        );
        
        var skillValues = {
            stirfry: chefTest.stirfryVal || 0,
            boil: chefTest.boilVal || 0,
            knife: chefTest.knifeVal || 0,
            fry: chefTest.fryVal || 0,
            bake: chefTest.bakeVal || 0,
            steam: chefTest.steamVal || 0
        };
        
        var deficit = 0;
        for (var skill in targetSkills) {
            var target = targetSkills[skill].target;
            var current = skillValues[skill] || 0;
            if (current < target) {
                deficit += (target - current);
            }
        }
        
        if (deficit === 0) {

            return {
                equip: equip,
                amber: selectedAmbers[0] ? selectedAmbers[0].amber : null,
                amberSlotIndex: selectedAmbers[0] ? selectedAmbers[0].slotIndex : -1,
                amberList: selectedAmbers,
                skillValues: skillValues,
                deficit: 0
            };
        }
        
        if (deficit < bestDeficit) {
            bestDeficit = deficit;
            bestResult = {
                equip: equip,
                amber: selectedAmbers[0] ? selectedAmbers[0].amber : null,
                amberSlotIndex: selectedAmbers[0] ? selectedAmbers[0].slotIndex : -1,
                amberList: selectedAmbers,
                skillValues: skillValues,
                deficit: deficit
            };
        }
    }

    return bestResult;
}

/**
 * 打印最终组合的厨师技法值日志
 */
function printFinalCombinationSkills(chef, skillValues, targetSkills) {
    var logParts = [];
    
    for (var i = 0; i < SKILL_TYPES.length; i++) {
        var s = SKILL_TYPES[i];
        var current = skillValues[s] || 0;
        var target = targetSkills[s] ? targetSkills[s].target : 0;
        if (target > 0) {
            var diff = current - target;
            logParts.push(SKILL_NAMES[s] + current + (diff >= 0 ? "(达标)" : "(差" + (-diff) + ")"));
        }
    }
    
}

/**
 * 设置菜谱神级方案查询结果到页面（带光环厨师）
 * @param {Object} chef - 目标厨师对象
 * @param {Object} recipe - 菜谱对象
 * @param {Object} rule - 规则对象
 * @param {Array} auraChefs - 光环厨师列表
 * @param {Boolean} useNext - 是否使用了Next厨师（Next厨师要在目标厨师前一位）
 * @param {Object} recommendedEquip - 推荐的厨具（可选）
 * @param {Object} recommendedAmber - 推荐的遗玉（可选）
 * @param {Array} recommendedAmberList - 推荐的遗玉列表（可选，用于多个红色槽位）
 */
function setRecipeGodResultToPageWithAura(chef, recipe, rule, auraChefs, useNext, recommendedEquip, recommendedAmber, recommendedAmberList) {
    if (recommendedEquip) {
    }
    if (recommendedAmber) {
    }
    if (recommendedAmberList && recommendedAmberList.length > 0) {
    }
    
    // 获取开关状态
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    var useAmber = $("#chk-cal-use-amber").prop("checked");
    
    // 先清空前几个位置
    var totalPositions = 1 + auraChefs.length;
    for (var pos = 0; pos < totalPositions; pos++) {
        setCustomChef(0, pos, null);
        setCustomEquip(0, pos, null);
        for (var j = 0; j < 3; j++) {
            setCustomRecipe(0, pos, j, null);
        }
    }
    
    var currentPos = 0;
    var targetChefPos = 0; // 记录目标厨师的位置
    
    // 如果使用了Next厨师，Next厨师要在目标厨师前一位
    if (useNext && auraChefs.length > 0) {
        // 找到Next厨师（第一个）
        var nextChef = auraChefs[0];
        setCustomChef(0, currentPos, nextChef.chefId);
        // 只有勾选了"已配厨具"才设置厨具
        if (useEquip && nextChef.equip && nextChef.equip.equipId) {
            setCustomEquip(0, currentPos, nextChef.equip.equipId);
        }
        currentPos++;
    }
    
    // 记录目标厨师位置
    targetChefPos = currentPos;
    
    // 设置目标厨师
    setCustomChef(0, currentPos, chef.chefId);
    
    // 设置厨具：优先使用推荐厨具，否则使用已配厨具
    if (recommendedEquip && recommendedEquip.equipId) {
        setCustomEquip(0, currentPos, recommendedEquip.equipId);
    } else if (useEquip && chef.equip && chef.equip.equipId) {
        setCustomEquip(0, currentPos, chef.equip.equipId);
    }
    
    // 设置菜谱到目标厨师的第一个菜谱位置
    setCustomRecipe(0, currentPos, 0, recipe.recipeId);
    currentPos++;
    
    // 设置其他光环厨师（Partial厨师）
    var startIndex = useNext ? 1 : 0; // 如果有Next厨师，从第二个开始
    for (var i = startIndex; i < auraChefs.length; i++) {
        var auraChef = auraChefs[i];
        setCustomChef(0, currentPos, auraChef.chefId);
        // 只有勾选了"已配厨具"才设置厨具
        if (useEquip && auraChef.equip && auraChef.equip.equipId) {
            setCustomEquip(0, currentPos, auraChef.equip.equipId);
        }
        currentPos++;
    }
    
    // 刷新计算结果
    if (typeof calCustomResults === 'function' && typeof cultivationGameData !== 'undefined') {
        calCustomResults(cultivationGameData);
    }
    
    // 设置推荐遗玉（需要在calCustomResults之后设置，因为calCustomResults会重置遗玉）
    // 优先使用amberList（多个槽位），否则使用单个amber
    var amberListToSet = recommendedAmberList && recommendedAmberList.length > 0 ? recommendedAmberList : 
                         (recommendedAmber ? [{ amber: recommendedAmber, slotIndex: -1 }] : []);
    
    if (amberListToSet.length > 0) {
        var customData = rule.custom && rule.custom[targetChefPos];
        if (customData && customData.chef && customData.chef.disk && customData.chef.disk.ambers) {
            // 如果amberList中的slotIndex有效，直接使用
            // 否则找所有红色槽位设置
            var hasValidSlotIndex = amberListToSet[0].slotIndex >= 0;
            
            if (hasValidSlotIndex) {
                // 使用amberList中指定的槽位
                for (var i = 0; i < amberListToSet.length; i++) {
                    var amberItem = amberListToSet[i];
                    if (amberItem.amber && amberItem.amber.amberId && amberItem.slotIndex >= 0) {
                        setCustomAmber(0, targetChefPos, amberItem.slotIndex, amberItem.amber.amberId);
                    }
                }
            } else {
                // 找所有红色槽位，设置同一个遗玉
                var amber = amberListToSet[0].amber;
                if (amber && amber.amberId) {
                    for (var slotIdx = 0; slotIdx < customData.chef.disk.ambers.length; slotIdx++) {
                        if (customData.chef.disk.ambers[slotIdx].type === 1) { // 红色槽位
                            setCustomAmber(0, targetChefPos, slotIdx, amber.amberId);
                        }
                    }
                }
            }
        }
        // 再次刷新计算结果
        if (typeof calCustomResults === 'function' && typeof cultivationGameData !== 'undefined') {
            calCustomResults(cultivationGameData);
        }
    }
    
}

/**
 * 判断厨师是否只有限时礼包来源
 * @param {Object} chef - 厨师对象
 * @returns {boolean} true表示只有限时礼包来源，应该被过滤
 */
function isGiftOnlyChef(chef) {
    if (!chef || !chef.origin) return false;
    
    // origin字段格式：单来源为"限时礼包"，多来源为"限时礼包<br>实验室"
    var origin = chef.origin;
    
    // 如果origin正好等于"限时礼包"，说明只有这一个来源
    if (origin === "限时礼包") {
        return true;
    }
    
    // 如果包含<br>，说明有多个来源，不过滤
    if (origin.indexOf("<br>") >= 0) {
        return false;
    }
    
    return false;
}

/**
 * 查找光环厨师（用于菜谱神级方案查询）
 * 逻辑：
 * 1. 只从"上场类已修炼"下拉框中勾选的厨师中查找
 * 2. 收集所有与差值技法类型相同的光环厨师
 * 3. Next类：取技法加成最大的1个
 * 4. Partial类：每种差值技法取技法加成最大的前2名
 * 5. 特殊光环厨师（conditionType: ChefTag）：单独收集，只对特定tags的厨师生效
 * 
 * @param {Array} chefs - 所有厨师列表
 * @param {Array} deficitSkills - 有差值的技法类型
 * @param {Object} targetChef - 目标厨师（用于排除自己和检查tags）
 * @returns {Object} { nextChef, nextValue, nextSkill, partialChefsBySkill, specialAuraChefs }
 */
function findAuraChefsForRecipeGod(chefs, deficitSkills, targetChef) {
    
    // 从"上场类已修炼"下拉框获取已勾选的厨师ID
    var enabledChefIds = $("#chk-cal-partial-ultimate").val() || [];
    var noGiftChef = $("#chk-cal-no-gift-chef").prop("checked");
    
    var nextChefs = [];      // 普通Next类光环厨师候选
    var partialChefsBySkill = {}; // 普通Partial类光环厨师，按差值技法分类
    var specialAuraChefs = []; // 特殊光环厨师（conditionType: ChefTag且目标厨师符合条件）
    
    // 初始化每种差值技法的Partial厨师列表
    for (var i = 0; i < deficitSkills.length; i++) {
        partialChefsBySkill[deficitSkills[i]] = [];
    }
    
    for (var i = 0; i < chefs.length; i++) {
        var chef = chefs[i];
        
        // 礼包厨师过滤
        if (noGiftChef && isGiftOnlyChef(chef)) {
            continue;
        }
        
        // 不再跳过任何厨师，让调用方根据需要动态排除
        // 这样当候选厨师自己是光环厨师时，可以从列表中找到替补
        
        // 只从"上场类已修炼"中勾选的厨师中查找
        var isEnabled = enabledChefIds.indexOf(String(chef.chefId)) >= 0 || 
                        enabledChefIds.indexOf(chef.chefId) >= 0;
        if (!isEnabled) continue;
        
        // 检查修炼技能
        if (!chef.ultimateSkillEffect) continue;
        
        for (var j = 0; j < chef.ultimateSkillEffect.length; j++) {
            var effect = chef.ultimateSkillEffect[j];
            
            // 只处理技法加成类型
            var skillType = SKILL_EFFECT_MAP[effect.type];
            if (!skillType) continue;
            
            // 检查是否是差值技法（只收集与差值技法相同的光环厨师）
            var isDeficitSkill = false;
            if (skillType === 'all') {
                // 全技法加成，对所有差值技法都有效
                isDeficitSkill = deficitSkills.length > 0;
            } else if (deficitSkills.indexOf(skillType) >= 0) {
                isDeficitSkill = true;
            }
            if (!isDeficitSkill) continue;
            
            var value = effect.value || 0;
            
            // 检查是否是特殊光环厨师（conditionType: ChefTag）
            if (effect.conditionType === 'ChefTag' && effect.conditionValueList) {
                // 特殊光环厨师：检查目标厨师的tags是否匹配
                var targetTags = targetChef.tags || [];
                var tagMatch = false;
                for (var k = 0; k < effect.conditionValueList.length; k++) {
                    if (targetTags.indexOf(effect.conditionValueList[k]) >= 0) {
                        tagMatch = true;
                        break;
                    }
                }
                
                if (tagMatch) {
                    // 目标厨师符合条件，作为额外的特殊光环厨师
                    specialAuraChefs.push({
                        chef: chef,
                        skill: skillType,
                        value: value,
                        condition: effect.condition,
                        conditionValueList: effect.conditionValueList
                    });
                }
                // 特殊光环厨师不放入普通列表，继续下一个effect
                continue;
            }
            
            // 普通光环厨师
            if (effect.condition === 'Next') {
                // Next类：收集所有，后面取技法加成最大的1个
                nextChefs.push({
                    chef: chef,
                    skill: skillType,
                    value: value
                });
            } else if (effect.condition === 'Partial') {
                // Partial类：按差值技法分类收集
                if (skillType === 'all') {
                    // 全技法加成，添加到所有差值技法
                    for (var k = 0; k < deficitSkills.length; k++) {
                        partialChefsBySkill[deficitSkills[k]].push({
                            chef: chef,
                            skill: 'all',
                            value: value
                        });
                    }
                } else {
                    // 单技法加成，只添加到对应的差值技法
                    partialChefsBySkill[skillType].push({
                        chef: chef,
                        skill: skillType,
                        value: value
                    });
                }
            }
        }
    }
    
    // 选择最佳Next厨师（技法加成最大的1个）
    var bestNextChef = null;
    var bestNextValue = 0;
    var bestNextSkill = null;
    for (var i = 0; i < nextChefs.length; i++) {
        if (nextChefs[i].value > bestNextValue) {
            bestNextValue = nextChefs[i].value;
            bestNextChef = nextChefs[i].chef;
            bestNextSkill = nextChefs[i].skill;
        }
    }
    
    // 选择Partial厨师（每种差值技法取技法加成最大的前3名，这样排除自己后还能有2个）
    var partialResult = {};
    for (var skill in partialChefsBySkill) {
        var skillChefs = partialChefsBySkill[skill];
        // 按技法加成值降序排序
        skillChefs.sort(function(a, b) {
            return b.value - a.value;
        });
        
        // 取前3名（排除自己后还能有2个）
        partialResult[skill] = skillChefs.slice(0, 3);
    }
    
    return {
        nextChef: bestNextChef,
        nextValue: bestNextValue,
        nextSkill: bestNextSkill,
        partialChefsBySkill: partialResult,
        specialAuraChefs: specialAuraChefs
    };
}

/**
 * 设置菜谱神级方案查询结果到页面
 * @param {Object} chef - 厨师对象
 * @param {Object} recipe - 菜谱对象
 * @param {Object} rule - 规则对象
 */
function setRecipeGodResultToPage(chef, recipe, rule) {
    // 获取"已配厨具"开关状态
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    
    // 先清空第一个位置
    setCustomChef(0, 0, null);
    setCustomEquip(0, 0, null);
    for (var j = 0; j < 3; j++) {
        setCustomRecipe(0, 0, j, null);
    }
    
    // 设置厨师
    setCustomChef(0, 0, chef.chefId);
    
    // 只有勾选了"已配厨具"才设置厨具
    if (useEquip && chef.equip && chef.equip.equipId) {
        setCustomEquip(0, 0, chef.equip.equipId);
    }
    
    // 设置菜谱到第一个菜谱位置
    setCustomRecipe(0, 0, 0, recipe.recipeId);
    
    // 刷新计算结果
    if (typeof calCustomResults === 'function' && typeof cultivationGameData !== 'undefined') {
        calCustomResults(cultivationGameData);
    }
    
}

/**
 * 获取菜谱神级方案查询配置
 */
function getRecipeGodQueryConfig() {
    var localData = getLocalData();
    var savedConfig = localData.recipeGodConfig || {};
    
    return {
        grade: parseInt($("#select-recipe-god-grade").val()) || savedConfig.grade || 4,
        useStrongEquip: $("#chk-recipe-god-use-strong-equip").prop("checked") || false
    };
}

/**
 * 计算目标品级需要的技法值
 */
function calculateTargetSkills(recipe, grade) {
    var skills = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    var result = {};
    
    for (var i = 0; i < skills.length; i++) {
        var skill = skills[i];
        var baseValue = recipe[skill] || 0;
        if (baseValue > 0) {
            result[skill] = {
                base: baseValue,
                target: baseValue * grade
            };
        }
    }
    
    return result;
}

/**
 * 过滤厨师 - 主函数
 */
function filterChefsForRecipeGod(chefs, recipe, targetSkills, config) {
    
    var gotChecked = $("#chk-cal-got").prop("checked");
    var ultimatedChecked = $("#chk-cal-ultimated").prop("checked");
    var isAllUltimated = $("#chk-cal-all-ultimated").prop("checked");
    var useEquip = $("#chk-cal-use-equip").prop("checked");
    var useAmber = $("#chk-cal-use-amber").prop("checked");
    var noGiftChef = $("#chk-cal-no-gift-chef").prop("checked");
    var maxTotalDeficit = config.useStrongEquip ? 400 : 250;
    
    // 获取规则数据（用于setDataForChef）
    var rule = calCustomRule.rules[0];
    
    
    var localData = getLocalData();
    var configIds = getConfigUltimatedChefIds();
    
    var result = [];
    var backupChefs = []; // 候补厨师列表（通过步骤1-3但差值不通过的厨师）
    var stats = {
        total: chefs.length,
        step0_gift: 0,
        step1_got: 0,
        step2_ultimated: 0,
        step3_baseSkill: 0,
        step4_deficit: 0,
        passed: 0
    };
    
    for (var i = 0; i < chefs.length; i++) {
        // 深拷贝厨师数据，避免修改原数据
        var chef = JSON.parse(JSON.stringify(chefs[i]));
        
        // 跳过特殊厨师
        if (chef.chefId === 285) continue;
        
        // 步骤0：礼包厨师过滤
        if (noGiftChef && isGiftOnlyChef(chef)) {
            stats.step0_gift++;
            continue;
        }
        
        // 步骤1：已有过滤
        if (gotChecked && !isAllUltimated) {
            var isOwned = chef.got || (configIds.allSet && configIds.allSet[String(chef.chefId)]);
            if (!isOwned) {
                stats.step1_got++;
                continue;
            }
        }
        
        // 步骤2：已修炼过滤
        if (ultimatedChecked && !isAllUltimated) {
            if (!isChefUltimated(chef.chefId, localData, configIds)) {
                stats.step2_ultimated++;
                continue;
            }
        }
        
        // 使用 setDataForChef 计算厨师技法值（包含厨具加成）
        var equipToUse = useEquip ? chef.equip : null;
        setDataForChef(
            chef,
            equipToUse,
            true,
            rule.calGlobalUltimateData,
            null, // partialAdds
            rule.calSelfUltimateData,
            rule.calActivityUltimateData,
            true,
            rule,
            useAmber,
            rule.calQixiaData || null
        );
        
        // 获取包含厨具加成的技法值
        var chefSkillValues = {
            stirfry: chef.stirfryVal || 0,
            boil: chef.boilVal || 0,
            knife: chef.knifeVal || 0,
            fry: chef.fryVal || 0,
            bake: chef.bakeVal || 0,
            steam: chef.steamVal || 0
        };
        
        // 计算不含厨具加成的基础技法值（用于步骤3和换厨具判断）
        var chefForBase = JSON.parse(JSON.stringify(chefs[i]));
        setDataForChef(
            chefForBase,
            null, // 不使用厨具
            true,
            rule.calGlobalUltimateData,
            null,
            rule.calSelfUltimateData,
            rule.calActivityUltimateData,
            true,
            rule,
            useAmber,
            rule.calQixiaData || null
        );
        var baseSkillValues = {
            stirfry: chefForBase.stirfryVal || 0,
            boil: chefForBase.boilVal || 0,
            knife: chefForBase.knifeVal || 0,
            fry: chefForBase.fryVal || 0,
            bake: chefForBase.bakeVal || 0,
            steam: chefForBase.steamVal || 0
        };
        
        // 步骤3：基础技法过滤（厨师技法值 >= 菜谱单倍技法值）
        // 注意：这里用不含厨具加成的基础值判断，因为厨具可以换
        var passBaseSkill = checkChefBaseSkillWithValues(baseSkillValues, targetSkills);
        if (!passBaseSkill) {
            stats.step3_baseSkill++;
            continue;
        }
        
        // 步骤4：差值过滤
        // 用包含已配厨具的技法值计算差值
        var deficitResult = checkChefDeficitWithValues(chefSkillValues, targetSkills, maxTotalDeficit, true);
        
        // 保存厨师数据（无论是否通过差值过滤）
        chef._skillValues = chefSkillValues;
        chef._deficits = deficitResult.deficits;
        chef._totalDeficit = deficitResult.totalDeficit;
        
        if (!deficitResult.pass) {
            stats.step4_deficit++;
            // 保存到候补列表（用于补全）
            backupChefs.push(chef);
            continue;
        }
        
        // 通过所有过滤
        result.push(chef);
        stats.passed++;
    }
    
    
    // 按总差值升序排序（差值小的优先）
    result.sort(function(a, b) {
        return a._totalDeficit - b._totalDeficit;
    });
    
    // 如果过滤后的厨师不足5个，使用差值最接近的厨师补全
    if (result.length < 5 && backupChefs.length > 0) {
        // 候补厨师按差值升序排序
        backupChefs.sort(function(a, b) {
            return a._totalDeficit - b._totalDeficit;
        });
        
        var needCount = 5 - result.length;
        var addedCount = 0;
        for (var j = 0; j < backupChefs.length && addedCount < needCount; j++) {
            // 检查是否已在结果中
            var alreadyInResult = false;
            for (var k = 0; k < result.length; k++) {
                if (result[k].chefId === backupChefs[j].chefId) {
                    alreadyInResult = true;
                    break;
                }
            }
            if (!alreadyInResult) {
                backupChefs[j]._isBackup = true; // 标记为候补厨师
                result.push(backupChefs[j]);
                addedCount++;
            }
        }
    }
    
    return result;
}

/**
 * 获取厨师实际技法值
 * useEquip=true: 使用stirfryVal（已包含厨具、遗玉等所有加成）
 * useEquip=false: 使用stirfry（厨师原始基础技法值，不含任何加成）
 */
function getChefActualSkillValues(chef, useEquip) {
    var skills = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
    var result = {};
    
    if (useEquip) {
        // 使用已包含所有加成的技法值
        for (var i = 0; i < skills.length; i++) {
            var skill = skills[i];
            result[skill] = chef[skill + 'Val'] || 0;
        }
    } else {
        // 使用厨师原始基础技法值（不含厨具、遗玉等加成）
        for (var i = 0; i < skills.length; i++) {
            var skill = skills[i];
            result[skill] = chef[skill] || 0;
        }
    }
    
    return result;
}

/**
 * 步骤3：检查厨师基础技法是否满足（使用实际技法值）
 */
function checkChefBaseSkillWithValues(chefSkillValues, targetSkills) {
    for (var skill in targetSkills) {
        var baseNeed = targetSkills[skill].base;
        var chefVal = chefSkillValues[skill] || 0;
        
        if (chefVal < baseNeed) {
            return false;
        }
    }
    return true;
}

/**
 * 步骤4：检查厨师差值是否可用厨具补上（使用实际技法值）
 * 规则：可以有多个技法有差值，但总差值 <= maxTotalDeficit
 */
function checkChefDeficitWithValues(chefSkillValues, targetSkills, maxTotalDeficit, canUseEquipToFix) {
    var deficits = [];
    var deficitDetails = {};
    var totalDeficit = 0;
    
    for (var skill in targetSkills) {
        var targetNeed = targetSkills[skill].target;
        var chefVal = chefSkillValues[skill] || 0;
        var deficit = targetNeed - chefVal;
        
        if (deficit > 0) {
            deficits.push({
                skill: skill,
                deficit: deficit
            });
            deficitDetails[skill] = deficit;
            totalDeficit += deficit;
        }
    }
    
    // 判断是否通过
    var pass = false;
    if (deficits.length === 0) {
        // 没有差值，直接通过
        pass = true;
    } else if (canUseEquipToFix) {
        // 可以用厨具补，检查总差值是否 <= maxTotalDeficit
        pass = totalDeficit <= maxTotalDeficit;
    } else {
        // 不能用厨具补，不通过
        pass = false;
    }
    
    return {
        pass: pass,
        deficits: deficitDetails,
        totalDeficit: totalDeficit,
        deficitCount: deficits.length
    };
}

/**
 * 初始化菜谱神级方案查询按钮事件
 */
function initRecipeGodQueryButton() {
    $("#btn-recipe-god-query").off("click").on("click", function() {
        queryRecipeGodPlan();
    });
}
