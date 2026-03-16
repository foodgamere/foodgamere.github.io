(function(window, $) {
    'use strict';

    if (!$) {
        return;
    }

    // =============================
    // 页面基础常量与区域元数据
    // =============================
    // 采集编队模式在规则下拉中的固定值。
    var MODE_VALUE = 'collection-team';
    // 各区域分组定义：
    // - names: 组内可查询地区
    // - formatName: 展示名称格式化（预留兼容不同命名）
    var AREA_DEFS = {
        veg: {
            names: ['池塘', '菜棚', '菜地', '森林', '牧场', '猪圈', '鸡舍', '作坊'],
            formatName: function(name) {
                return name;
            }
        },
        jade: {
            names: ['藏心亭', '朝阴山', '北冥城', '清空谷', '还寒洞', '永昼宫'],
            formatName: function(name) {
                return name;
            }
        },
        lab: {
            names: ['蒸', '炸', '炒', '煮', '切', '烤'],
            formatName: function(name) {
                return name;
            }
        },
        cond: {
            names: ['樊正阁', '庖丁阁', '膳祖阁', '易牙阁', '彭铿阁', '伊尹阁'],
            formatName: function(name) {
                return name;
            }
        }
    };
    // 保存编队弹窗中的分组标签顺序。
    var AREA_GROUP_ORDER = ['jade', 'veg', 'cond', 'lab'];
    // 分组标签对应的中文标题。
    var AREA_GROUP_TITLES = {
        veg: '菜地区',
        jade: '玉片区',
        lab: '实验室',
        cond: '调料区'
    };
    // 菜地区每个地点的基础配置：素材类型、默认采集点、可选采集点档位。
    var VEG_AREA_META = {
        '池塘': { materialType: '鱼', defaultCapacity: 29, capacityOptions: [29, 24, 19, 14, 9, 5] },
        '菜棚': { materialType: '菜', defaultCapacity: 25, capacityOptions: [25, 20, 15, 8, 4, 1] },
        '菜地': { materialType: '菜', defaultCapacity: 30, capacityOptions: [30, 22, 16, 8, 5, 1] },
        '森林': { materialType: '菜', defaultCapacity: 32, capacityOptions: [32, 27, 17, 12, 6, 2] },
        '牧场': { materialType: '肉', defaultCapacity: 25, capacityOptions: [25, 19, 13, 6, 1] },
        '猪圈': { materialType: '肉', defaultCapacity: 18, capacityOptions: [18, 12, 7, 5, 1] },
        '鸡舍': { materialType: '肉', defaultCapacity: 24, capacityOptions: [24, 18, 14, 8, 4, 1] },
        '作坊': { materialType: '面', defaultCapacity: 26, capacityOptions: [26, 21, 16, 11, 5, 1] }
    };
    // 玉片区可选采集点档位。
    var JADE_CAPACITY_OPTIONS = [165, 150, 135, 120, 105, 90, 75, 60, 45, 30, 15];
    // 人数配置统一档位。
    var DEFAULT_PEOPLE_OPTIONS = [5, 4, 3, 2, 1, 0];
    // 页面运行态：UI展开状态、区域开关、排序缓存、查询结果等。
    var state = {
        settingsExpanded: true,
        areaEnabled: {
            veg: true,
            jade: true,
            lab: false,
            cond: false
        },
        sortCache: null,
        sortCacheTimer: null,
        bootstrappingRule: false,
        bootstrapTimer: null,
        queryLoading: false,
        queryResults: null,
        activePreviewGroup: 'veg'
    };

    // 确保采集编队根节点存在，不存在则在自定义面板下创建。
    function ensureRoot() {
        var $root = $('#collection-team-root');
        if ($root.length) {
            return $root;
        }

        $('#pane-cal-custom').append('<div id="collection-team-root" class="collection-team-root hidden"></div>');
        return $('#collection-team-root');
    }

    // 退出采集编队模式时清理定时器和DOM状态。
    function resetMode() {
        if (state.bootstrapTimer) {
            window.clearTimeout(state.bootstrapTimer);
            state.bootstrapTimer = null;
        }
        state.bootstrappingRule = false;
        $('#collection-team-root').addClass('hidden').empty();
        $('#pane-cal-custom').removeClass('collection-team-mode');
    }

    // 规则加载后才允许查询，避免用空规则计算。
    function hasCollectionRuleReady() {
        var rule = window.calCustomRule && window.calCustomRule.rules && window.calCustomRule.rules[0];
        return !!(rule && Array.isArray(rule.chefs) && Array.isArray(rule.equips) && Array.isArray(rule.ambers));
    }

    // 自动临时切换到规则0触发基础数据加载，再恢复用户原规则。
    // 作用：首次进入采集编队模式时保证 calCustomRule.rules[0] 结构完整。
    function bootstrapCollectionRule() {
        var $select;
        var originalValue;

        if (state.bootstrappingRule || hasCollectionRuleReady()) {
            return;
        }

        $select = $('#select-cal-rule');
        if (!$select.length || !$select.find("option[value='0']").length || !$('#btn-cal-rule-load').length) {
            return;
        }

        state.bootstrappingRule = true;
        originalValue = $select.val();
        $select.val('0').selectpicker('refresh');
        $('#btn-cal-rule-load').addClass('btn-danger').trigger('click');

        // 恢复原规则并重新加载采集编队页面。
        function restoreCollectionMode() {
            if (state.bootstrapTimer) {
                window.clearTimeout(state.bootstrapTimer);
                state.bootstrapTimer = null;
            }
            $select.val(originalValue).selectpicker('refresh');
            state.bootstrappingRule = false;
            load();
        }

        // 轮询等待规则可用，超时后也会恢复页面避免卡死。
        function waitForRule(retryCount) {
            if (hasCollectionRuleReady() || retryCount <= 0) {
                restoreCollectionMode();
                return;
            }
            state.bootstrapTimer = window.setTimeout(function() {
                waitForRule(retryCount - 1);
            }, 40);
        }

        waitForRule(25);
    }

    // 将计算器切换到规则子页，保证采集编队UI展示位置正确。
    function activateRulesPane() {
        var $ruleRadio = $("input[name='rad-cal-pane-options'][data-pane='.pane-cal-rules']");
        if (!$ruleRadio.length) {
            return;
        }

        $ruleRadio.prop('checked', true);
        $("input[name='rad-cal-pane-options']").closest('label').removeClass('active');
        $ruleRadio.closest('label').addClass('active');

        if (typeof window.showCalSubPane === 'function') {
            window.showCalSubPane();
        } else {
            $('.pane-cal-sub').addClass('hidden');
            $('#pane-cal-rules').removeClass('hidden');
        }
    }

    // 生成当前账号隔离的 localStorage key，避免多账号数据串线。
    function getCollectionStorageKey(name) {
        var userKey = typeof window.getCurrentStorageKey === 'function' ? window.getCurrentStorageKey() : 'data';
        return 'collection::' + userKey + '::' + name;
    }

    // 获取区域配置元数据（默认采集点/可选档位等）。
    function getAreaMeta(prefix, name) {
        if (prefix === 'veg') {
            return VEG_AREA_META[name] || { materialType: '', defaultCapacity: 29, capacityOptions: [29] };
        }
        if (prefix === 'jade') {
            return { defaultCapacity: 60, capacityOptions: JADE_CAPACITY_OPTIONS.slice() };
        }
        if (prefix === 'lab') {
            return { defaultCapacity: 60, capacityOptions: [60] };
        }
        if (prefix === 'cond') {
            return { defaultCapacity: 60, capacityOptions: [60] };
        }
        return { defaultCapacity: 60, capacityOptions: [60] };
    }

    // 人数配置存储键。
    function getAreaPeopleKey(prefix, name) {
        return prefix + '_people::' + name;
    }

    // 采集点配置存储键。
    function getAreaCapacityKey(prefix, name) {
        return prefix + '_capacity::' + name;
    }

    // 读取区域人数配置，默认5人。
    function getStoredAreaPeople(prefix, name) {
        var raw = window.localStorage.getItem(getCollectionStorageKey(getAreaPeopleKey(prefix, name)));
        var value = parseInt(raw, 10);
        return Number.isNaN(value) ? 5 : value;
    }

    // 读取区域采集点配置，未配置时使用区域默认值。
    function getStoredAreaCapacity(prefix, name) {
        var meta = getAreaMeta(prefix, name);
        var raw = window.localStorage.getItem(getCollectionStorageKey(getAreaCapacityKey(prefix, name)));
        var value = parseInt(raw, 10);
        return Number.isNaN(value) ? meta.defaultCapacity : value;
    }

    // 持久化区域人数配置。
    function saveStoredAreaPeople(prefix, name, value) {
        window.localStorage.setItem(getCollectionStorageKey(getAreaPeopleKey(prefix, name)), String(value));
    }

    // 持久化区域采集点配置。
    function saveStoredAreaCapacity(prefix, name, value) {
        window.localStorage.setItem(getCollectionStorageKey(getAreaCapacityKey(prefix, name)), String(value));
    }

    // 读取布尔配置（区域开关、厨具策略等）。
    function loadBooleanSetting(name, fallback) {
        var value = window.localStorage.getItem(getCollectionStorageKey(name));
        if (value === null) {
            return fallback;
        }
        return value === 'true';
    }

    // 保存布尔配置。
    function saveBooleanSetting(name, value) {
        window.localStorage.setItem(getCollectionStorageKey(name), value ? 'true' : 'false');
    }

    // 读取统一区域排序；兼容历史逗号串与新JSON格式。
    function loadUnifiedAreaOrder() {
        var raw = window.localStorage.getItem(getCollectionStorageKey('unified_area_order'));
        if (!raw) {
            return [];
        }
        try {
            if (raw.charAt(0) === '[') {
                return JSON.parse(raw);
            }
        } catch (e) {}
        return raw.split(',').filter(function(item) {
            return item;
        });
    }

    // 保存统一区域排序。
    function saveUnifiedAreaOrder(order) {
        window.localStorage.setItem(getCollectionStorageKey('unified_area_order'), JSON.stringify(order));
    }

    // 获取已保存组合占用的地区名称集合（这些地区在排序列表中隐藏）。
    function getSavedAreaNames() {
        var result = [];
        var seen = {};
        loadSavedCombinationBundle().items.forEach(function(item) {
            if (!seen[item.areaName]) {
                seen[item.areaName] = true;
                result.push(item.areaName);
            }
        });
        return result;
    }

    // 统一把数组/对象值转为数组，便于兼容多来源数据结构。
    function toArray(value) {
        if (Array.isArray(value)) {
            return value;
        }
        if (!value || typeof value !== 'object') {
            return [];
        }
        return Object.keys(value).map(function(key) {
            return value[key];
        });
    }

    // 安全转整数，失败回退 fallback。
    function toInt(value, fallback) {
        var parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? fallback : parsed;
    }

    // 宽松布尔解析（兼容 true/1/yes/是）。
    function toBoolean(value) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            return value > 0;
        }
        if (typeof value === 'string') {
            return value === 'true' || value === '1' || value === 'yes' || value === '是';
        }
        return false;
    }

    // 解析保存时间，兼容秒/毫秒时间戳与日期字符串。
    function parseSavedTime(value) {
        var dateValue;
        var numberValue;
        if (value === null || typeof value === 'undefined' || value === '') {
            return 0;
        }
        if (typeof value === 'number') {
            return value < 1000000000000 ? value * 1000 : value;
        }
        numberValue = parseInt(value, 10);
        if (!Number.isNaN(numberValue) && String(Math.abs(numberValue)).length >= 10) {
            return numberValue < 1000000000000 ? numberValue * 1000 : numberValue;
        }
        dateValue = new Date(value).getTime();
        return Number.isNaN(dateValue) ? 0 : dateValue;
    }

    // 格式化保存时间文本。
    function formatSavedTime(timestamp, withTime) {
        var date = new Date(timestamp);
        // 补零到两位数字。
        function pad(value) {
            return value < 10 ? '0' + value : String(value);
        }

        if (!timestamp || Number.isNaN(date.getTime())) {
            return '--';
        }
        return [
            date.getFullYear(),
            '-',
            pad(date.getMonth() + 1),
            '-',
            pad(date.getDate()),
            withTime ? (' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())) : ''
        ].join('');
    }

    // 根据地区名称推断所在分组（菜/玉片/实验室/调料）。
    function getAreaGroupKeyByAreaName(areaName) {
        var matchedKey = 'veg';
        Object.keys(AREA_DEFS).some(function(key) {
            if (AREA_DEFS[key].names.indexOf(areaName) >= 0) {
                matchedKey = key;
                return true;
            }
            return false;
        });
        return matchedKey;
    }

    // 判断是否实验室地区。
    function isLabAreaName(areaName) {
        return getAreaGroupKeyByAreaName(areaName) === 'lab';
    }

    // 判断是否菜地区。
    function isVegAreaName(areaName) {
        return getAreaGroupKeyByAreaName(areaName) === 'veg';
    }

    // 判断是否玉片区。
    function isJadeAreaName(areaName) {
        return getAreaGroupKeyByAreaName(areaName) === 'jade';
    }

    // 规范化保存的厨师结构，兼容旧字段名。
    function normalizeSavedChef(rawChef, areaName) {
        var chef = rawChef && typeof rawChef === 'object' ? rawChef : {};
        return {
            name: chef.name || chef.chefName || chef.nickName || '未知厨师',
            rarity: Math.max(0, Math.min(5, toInt(chef.rarity || chef.star || chef.stars || chef.grade, 0))),
            area: chef.area || chef.areaName || areaName || '',
            collectionDetails: chef.collectionDetails || chef.chefCollectionDetails || chef.details || chef.desc || '',
            isUltimate: toBoolean(chef.isUltimate || chef.ult || chef.ultimate || chef.cultivated),
            critChance: toInt(chef.critChance || chef.totalCritChance, 0),
            critMaterial: toInt(chef.critMaterial || chef.totalCritMaterial, 0),
            materialGain: toInt(chef.materialGain || chef.totalMaterialGain, 0),
            origin: chef.origin || chef.source || '',
            redAmberCount: toInt(chef.redAmberCount || chef.redAmber || chef.redCount, 0)
        };
    }

    // 规范化保存的组合结构，补齐 area/group/time 等关键字段。
    function normalizeSavedCombination(rawItem, storageIndex) {
        var item = rawItem && typeof rawItem === 'object' ? rawItem : null;
        var areaName;
        var chefs;
        var savedTime;

        if (!item) {
            return null;
        }

        areaName = item.areaName || item.name || item.area || item.area_type || '';
        if (!areaName) {
            return null;
        }

        savedTime = parseSavedTime(item.savedTime || item.saveTime || item.timestamp || item.createTime || item.updatedAt);
        chefs = toArray(item.chefs || item.chefList || item.members || item.results || item.savedChefInfos).map(function(chef) {
            return normalizeSavedChef(chef, areaName);
        });

        return {
            id: (item.id !== null && typeof item.id !== 'undefined' ? String(item.id) : 'collection_saved') + '::' + storageIndex,
            areaName: areaName,
            areaGroupKey: getAreaGroupKeyByAreaName(areaName),
            savedTime: savedTime,
            chefs: chefs,
            raw: item,
            storageIndex: storageIndex
        };
    }

    // 读取本地保存的编队列表并标准化，按时间倒序展示。
    function loadSavedCombinationBundle() {
        var raw = window.localStorage.getItem(getCollectionStorageKey('saved_combinations'));
        var rawList = [];
        var items = [];

        if (!raw) {
            return {
                rawList: rawList,
                items: items
            };
        }

        try {
            rawList = JSON.parse(raw);
        } catch (e) {
            rawList = [];
        }

        if (!Array.isArray(rawList)) {
            rawList = [];
        }

        rawList.forEach(function(item, index) {
            var normalized = normalizeSavedCombination(item, index);
            if (normalized) {
                items.push(normalized);
            }
        });

        items.sort(function(left, right) {
            if (right.savedTime !== left.savedTime) {
                return right.savedTime - left.savedTime;
            }
            return left.storageIndex - right.storageIndex;
        });

        return {
            rawList: rawList,
            items: items
        };
    }

    // 保存编队原始列表；空列表时删除存储键。
    function saveSavedCombinationRawList(rawList) {
        if (!rawList.length) {
            window.localStorage.removeItem(getCollectionStorageKey('saved_combinations'));
            return;
        }
        window.localStorage.setItem(getCollectionStorageKey('saved_combinations'), JSON.stringify(rawList));
    }

    // 读取“方案”列表（多地区组合），按保存时间倒序。
    function loadSavedCombinationSchemes() {
        var raw = window.localStorage.getItem(getCollectionStorageKey('saved_combination_schemes'));
        var list;
        if (!raw) {
            return [];
        }
        try {
            list = JSON.parse(raw);
        } catch (e) {
            list = [];
        }
        if (!Array.isArray(list)) {
            return [];
        }
        return list.filter(function(item) {
            return item && typeof item === 'object' && item.name;
        }).sort(function(left, right) {
            return parseSavedTime(right.savedTime || right.time) - parseSavedTime(left.savedTime || left.time);
        });
    }

    // 保存“方案”列表。
    function saveSavedCombinationSchemes(schemes) {
        if (!schemes.length) {
            window.localStorage.removeItem(getCollectionStorageKey('saved_combination_schemes'));
            return;
        }
        window.localStorage.setItem(getCollectionStorageKey('saved_combination_schemes'), JSON.stringify(schemes));
    }

    // 判断两个排序数组是否完全一致。
    function hasSameOrder(left, right) {
        var i;
        if (left.length !== right.length) {
            return false;
        }
        for (i = 0; i < left.length; i++) {
            if (left[i] !== right[i]) {
                return false;
            }
        }
        return true;
    }

    // 判断该地区是否已被保存编队占用（占用地区不参与当前查询排序）。
    function isSavedArea(prefix, name, savedAreaNames) {
        var displayName = AREA_DEFS[prefix].formatName(name);
        return savedAreaNames.indexOf(name) >= 0 || savedAreaNames.indexOf(displayName) >= 0 || savedAreaNames.indexOf(name + '技法') >= 0;
    }

    // 汇总当前启用且未被已保存编队占用的地区列表。
    function getEnabledAreaItems(savedAreaNames) {
        var items = [];
        ['veg', 'jade', 'lab', 'cond'].forEach(function(prefix) {
            if (!state.areaEnabled[prefix]) {
                return;
            }
            AREA_DEFS[prefix].names.forEach(function(name) {
                if (isSavedArea(prefix, name, savedAreaNames)) {
                    return;
                }
                items.push({
                    id: prefix + '_' + name,
                    prefix: prefix,
                    name: name,
                    displayName: AREA_DEFS[prefix].formatName(name),
                    people: getStoredAreaPeople(prefix, name),
                    capacity: getStoredAreaCapacity(prefix, name),
                    meta: getAreaMeta(prefix, name)
                });
            });
        });
        return items;
    }

    // 同步并修正“统一区域顺序”：保留已有顺序，补齐新增项，清理失效项。
    function syncUnifiedAreaOrder(savedAreaNames, enabledItems) {
        var itemMap = {};
        var storedOrder = loadUnifiedAreaOrder();
        var nextOrder = [];

        savedAreaNames = savedAreaNames || getSavedAreaNames();
        enabledItems = enabledItems || getEnabledAreaItems(savedAreaNames);

        enabledItems.forEach(function(item) {
            itemMap[item.id] = item;
        });

        storedOrder.forEach(function(id) {
            if (itemMap[id]) {
                nextOrder.push(id);
                delete itemMap[id];
            }
        });

        enabledItems.forEach(function(item) {
            if (itemMap[item.id]) {
                nextOrder.push(item.id);
            }
        });

        if (!hasSameOrder(storedOrder, nextOrder)) {
            saveUnifiedAreaOrder(nextOrder);
        }
        return nextOrder;
    }

    // 从本地存储恢复页面开关状态。
    function loadStoredState() {
        state.areaEnabled.veg = loadBooleanSetting('veg_enabled', true);
        state.areaEnabled.jade = loadBooleanSetting('jade_enabled', true);
        state.areaEnabled.lab = loadBooleanSetting('lab_enabled', false);
        state.areaEnabled.cond = false;
        syncUnifiedAreaOrder();
    }

    // 基础HTML转义，防止插入文本破坏结构。
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 构建排序面板的数据源（按统一顺序输出）。
    function buildSortItems() {
        var savedAreaNames = getSavedAreaNames();
        var enabledItems = getEnabledAreaItems(savedAreaNames);
        var itemMap = {};
        var order = syncUnifiedAreaOrder(savedAreaNames, enabledItems);
        var items = [];

        enabledItems.forEach(function(item) {
            itemMap[item.id] = item;
        });

        order.forEach(function(id) {
            if (itemMap[id]) {
                items.push(itemMap[id]);
                delete itemMap[id];
            }
        });

        enabledItems.forEach(function(item) {
            if (itemMap[item.id]) {
                items.push(item);
            }
        });

        return {
            items: items,
            savedAreaNames: savedAreaNames
        };
    }

    // 排序弹窗列表HTML（含人数/采集点/拖拽按钮）。
    function getSortListHtml(items) {
        var html = '';
        if (!items.length) {
            return '<div class="collection-sort-empty">当前没有可排序区域</div>';
        }

        items.forEach(function(item, index) {
            var peopleOptions = DEFAULT_PEOPLE_OPTIONS.map(function(option) {
                return '<option value="' + option + '"' + (item.people === option ? ' selected' : '') + '>' + option + '</option>';
            }).join('');
            var capacityOptions = item.meta.capacityOptions.map(function(option) {
                return '<option value="' + option + '"' + (item.capacity === option ? ' selected' : '') + '>' + option + '</option>';
            }).join('');
            html += [
                '<div class="collection-sort-item collection-sort-item-', escapeHtml(item.prefix), '" draggable="true" data-id="', escapeHtml(item.id), '">',
                    '<div class="collection-sort-item-main">',
                        '<span class="collection-sort-badge collection-sort-badge-', escapeHtml(item.prefix), '">', item.prefix === 'jade' ? '玉' : (item.prefix === 'veg' ? '菜' : (item.prefix === 'lab' ? '实' : '料')), '</span>',
                        '<span class="collection-sort-name collection-sort-name-', escapeHtml(item.prefix), ' collection-sort-name-', escapeHtml(item.name), '">', escapeHtml(item.displayName), '</span>',
                        '<span class="collection-sort-divider">|</span>',
                        '<span class="collection-sort-label">人数</span>',
                        '<select class="collection-sort-select collection-sort-people selectpicker monitor-none" data-id="', escapeHtml(item.id), '" data-width="60px" data-dropdown-align-right="auto">', peopleOptions, '</select>',
                        item.prefix !== 'lab' ? '<span class="collection-sort-label">采集点</span>' : '',
                        item.prefix !== 'lab' ? '<select class="collection-sort-select collection-sort-capacity selectpicker monitor-none" data-id="' + escapeHtml(item.id) + '" data-width="70px" data-dropdown-align-right="auto">' + capacityOptions + '</select>' : '',
                    '</div>',
                    '<div class="collection-sort-item-actions">',
                        '<div class="collection-sort-move-group">',
                            '<button type="button" class="btn btn-default btn-xs collection-sort-move" data-id="', escapeHtml(item.id), '" data-dir="up">',
                                '<span class="glyphicon glyphicon-chevron-up"></span>',
                            '</button>',
                            '<button type="button" class="btn btn-default btn-xs collection-sort-move" data-id="', escapeHtml(item.id), '" data-dir="down">',
                                '<span class="glyphicon glyphicon-chevron-down"></span>',
                            '</button>',
                        '</div>',
                        '<span class="collection-sort-drag-handle glyphicon glyphicon-menu-hamburger"></span>',
                    '</div>',
                '</div>'
            ].join('');
        });

        return html;
    }

    // 将排序列表渲染到弹窗。
    function renderSortList($dialog, items) {
        $dialog.find('.collection-sort-list').html(getSortListHtml(items));
    }

    // 构建排序缓存，减少频繁打开弹窗时的重复计算。
    function buildSortCache() {
        var data = buildSortItems();
        return {
            items: data.items.slice(),
            savedAreaNames: data.savedAreaNames.slice(),
            noteText: data.savedAreaNames.length ? ('已保存组合地区不会参与排序：' + data.savedAreaNames.join('、')) : '',
            listHtml: getSortListHtml(data.items)
        };
    }

    // 立即刷新排序缓存。
    function refreshSortCache() {
        state.sortCache = buildSortCache();
        return state.sortCache;
    }

    // 异步调度刷新缓存，合并短时间内的重复触发。
    function scheduleSortCacheRefresh() {
        if (state.sortCacheTimer) {
            window.clearTimeout(state.sortCacheTimer);
        }
        state.sortCacheTimer = window.setTimeout(function() {
            state.sortCacheTimer = null;
            refreshSortCache();
        }, 0);
    }

    // 持久化当前排序顺序。
    function persistSortItems(items) {
        saveUnifiedAreaOrder(items.map(function(item) {
            return item.id;
        }));
    }

    // 根据id查询排序项索引。
    function getSortItemIndex(items, id) {
        var index = -1;
        items.some(function(item, itemIndex) {
            if (item.id === id) {
                index = itemIndex;
                return true;
            }
            return false;
        });
        return index;
    }

    // 更新某个排序项（人数/采集点等）。
    function updateSortItem(items, id, patch) {
        return items.map(function(item) {
            if (item.id === id) {
                return $.extend({}, item, patch);
            }
            return item;
        });
    }

    // 调整排序项位置并保存。
    function moveSortItem(items, fromIndex, toIndex) {
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) {
            return items;
        }
        var next = items.slice();
        var moved = next.splice(fromIndex, 1)[0];
        next.splice(toIndex, 0, moved);
        persistSortItems(next);
        return next;
    }

    // 初始化排序弹窗里的下拉框样式（对齐菜单中菜谱星级 selectpicker 样式）。
    function initSortDialogSelectPickers($dialog) {
        var $selects = $dialog.find('.collection-sort-select');
        if (!$selects.length || typeof $selects.selectpicker !== 'function') {
            return;
        }
        try {
            $selects.selectpicker('destroy');
        } catch (e) {}
        $selects.selectpicker({
            style: 'btn-default',
            dropupAuto: false,
            width: 'fit'
        });
        $selects.selectpicker('render');
        $selects.selectpicker('refresh');
    }

    // 打开排序弹窗，支持上下移动与拖拽重排。
    function showSortDialog() {
        var cache = state.sortCache || refreshSortCache();
        var items = cache.items.slice();
        var dragId = null;
        var currentDropTarget = null;
        // 重置为当前可用区域的默认顺序。
        function resetSortItems() {
            items = getEnabledAreaItems(getSavedAreaNames());
            persistSortItems(items);
            refreshSortCache();
            refreshSortDialogUi();
        }
        var dialog = bootbox.dialog({
            title: '<div class="collection-sort-title-row"><span class="collection-sort-title-text">排序</span><span class="collection-sort-title-hint">拖动或使用上下按钮调整顺序</span></div>',
            className: 'collection-sort-modal',
            backdrop: true,
            onEscape: true,
            message: [
                '<div class="collection-sort-dialog">',
                    '<div class="collection-sort-note', cache.noteText ? '' : ' hidden', '">', escapeHtml(cache.noteText), '</div>',
                    '<div class="collection-sort-list">', cache.listHtml, '</div>',
                '</div>'
            ].join(''),
            buttons: {}
        });

        dialog.find('.modal-header').append('<button type="button" class="btn btn-default collection-sort-header-reset" data-action="sort-reset-header">重置</button>');
        initSortDialogSelectPickers(dialog);

        function refreshSortDialogUi() {
            renderSortList(dialog, items);
            initSortDialogSelectPickers(dialog);
        }

        dialog.on('click', '[data-action="sort-reset-header"]', function() {
            resetSortItems();
        });

        dialog.on('click', '.collection-sort-move', function() {
            var id = $(this).data('id');
            var dir = $(this).data('dir');
            var fromIndex = getSortItemIndex(items, id);
            var toIndex = dir === 'up' ? fromIndex - 1 : fromIndex + 1;
            items = moveSortItem(items, fromIndex, toIndex);
            state.sortCache = {
                items: items.slice(),
                savedAreaNames: (state.sortCache && state.sortCache.savedAreaNames ? state.sortCache.savedAreaNames.slice() : []),
                noteText: state.sortCache ? state.sortCache.noteText : '',
                listHtml: getSortListHtml(items)
            };
            refreshSortDialogUi();
        });

        dialog.on('change', '.collection-sort-people', function() {
            var id = $(this).data('id');
            var value = parseInt($(this).val(), 10);
            var index = getSortItemIndex(items, id);
            if (index < 0) {
                return;
            }
            items = updateSortItem(items, id, { people: value });
            saveStoredAreaPeople(items[index].prefix, items[index].name, value);
            state.sortCache = {
                items: items.slice(),
                savedAreaNames: (state.sortCache && state.sortCache.savedAreaNames ? state.sortCache.savedAreaNames.slice() : []),
                noteText: state.sortCache ? state.sortCache.noteText : '',
                listHtml: getSortListHtml(items)
            };
            refreshSortDialogUi();
        });

        dialog.on('change', '.collection-sort-capacity', function() {
            var id = $(this).data('id');
            var value = parseInt($(this).val(), 10);
            var index = getSortItemIndex(items, id);
            if (index < 0) {
                return;
            }
            items = updateSortItem(items, id, { capacity: value });
            saveStoredAreaCapacity(items[index].prefix, items[index].name, value);
            state.sortCache = {
                items: items.slice(),
                savedAreaNames: (state.sortCache && state.sortCache.savedAreaNames ? state.sortCache.savedAreaNames.slice() : []),
                noteText: state.sortCache ? state.sortCache.noteText : '',
                listHtml: getSortListHtml(items)
            };
            refreshSortDialogUi();
        });

        dialog.on('dragstart', '.collection-sort-item', function(event) {
            dragId = $(this).data('id');
            currentDropTarget = null;
            $(this).addClass('is-dragging');
            if (event.originalEvent && event.originalEvent.dataTransfer) {
                event.originalEvent.dataTransfer.effectAllowed = 'move';
                event.originalEvent.dataTransfer.setData('text/plain', dragId);
            }
        });

        dialog.on('dragend', '.collection-sort-item', function() {
            dragId = null;
            currentDropTarget = null;
            dialog.find('.collection-sort-item').removeClass('is-dragging is-drop-target');
        });

        dialog.on('dragover', '.collection-sort-item', function(event) {
            event.preventDefault();
            var targetId = $(this).data('id');
            if (currentDropTarget !== targetId) {
                currentDropTarget = targetId;
                dialog.find('.collection-sort-item').removeClass('is-drop-target');
                $(this).addClass('is-drop-target');
            }
        });

        dialog.on('drop', '.collection-sort-item', function(event) {
            event.preventDefault();
            var targetId = $(this).data('id');
            var fromIndex;
            var toIndex;
            currentDropTarget = null;
            dialog.find('.collection-sort-item').removeClass('is-drop-target');
            if (!dragId || dragId === targetId) {
                return;
            }
            fromIndex = getSortItemIndex(items, dragId);
            toIndex = getSortItemIndex(items, targetId);
            items = moveSortItem(items, fromIndex, toIndex);
            state.sortCache = {
                items: items.slice(),
                savedAreaNames: (state.sortCache && state.sortCache.savedAreaNames ? state.sortCache.savedAreaNames.slice() : []),
                noteText: state.sortCache ? state.sortCache.noteText : '',
                listHtml: getSortListHtml(items)
            };
            refreshSortDialogUi();
        });
    }

    // 统计当前已选编队数量。
    function getSelectedCombinationCount(selectedMap) {
        return Object.keys(selectedMap).length;
    }

    // 生成星级显示HTML。
    function getCombinationStarsHtml(rarity) {
        var stars = '';
        var i;
        for (i = 0; i < rarity; i++) {
            stars += '<span class="collection-team-chef-star">★</span>';
        }
        return stars;
    }

    // 处理来源文本中的换行分隔（<br> -> 、）。
    function formatOriginText(origin) {
        return escapeHtml(String(origin || '').replace(/<br\s*\/?>/gi, '、'));
    }

    // 在编队详情中高亮当前地区的关键采集信息。
    function getHighlightedCollectionDetailsHtml(chef) {
        var details = String(chef.collectionDetails || '');
        var targetType;
        var parts;
        var match;

        if (!details) {
            return '<span class="collection-team-chef-muted">暂无采集信息</span>';
        }

        if (isLabAreaName(chef.area)) {
            match = details.match(/^(.*?)([（(]光环.*)$/);
            if (match) {
                return '<span class="collection-team-chef-detail-emphasis">' + escapeHtml(match[1]) + '</span><span class="collection-team-chef-detail-muted">' + escapeHtml(match[2]) + '</span>';
            }
            return '<span class="collection-team-chef-detail-emphasis">' + escapeHtml(details) + '</span>';
        }

        if (isJadeAreaName(chef.area)) {
            return '<span class="collection-team-chef-detail-emphasis">' + escapeHtml(details) + '</span>';
        }

        if (isVegAreaName(chef.area)) {
            targetType = VEG_AREA_META[chef.area] ? VEG_AREA_META[chef.area].materialType : '';
            parts = details.split(/\s+/).filter(function(item) {
                return item;
            });
            return parts.map(function(part) {
                if (targetType && part.indexOf(targetType + ':') === 0) {
                    return '<span class="collection-team-chef-detail-emphasis">' + escapeHtml(part) + '</span>';
                }
                return '<span>' + escapeHtml(part) + '</span>';
            }).join('<span class="collection-team-chef-detail-space"></span>');
        }

        return escapeHtml(details);
    }

    // 保存编队详情里的单个厨师卡片HTML。
    function getSavedChefRowHtml(chef) {
        var isLabArea = isLabAreaName(chef.area);
        var rarityHtml = getCombinationStarsHtml(chef.rarity);
        var originHtml = formatOriginText(chef.origin || '未知');
        return [
            '<div class="collection-team-chef-card">',
                '<div class="collection-team-chef-row">',
                    '<div class="collection-team-chef-head">',
                        '<span class="collection-team-chef-name">', escapeHtml(chef.name), '</span>',
                        rarityHtml ? '<span class="collection-team-chef-stars">' + rarityHtml + '</span>' : '',
                        isLabArea ? '<span class="collection-team-chef-red-amber' + (chef.redAmberCount ? ' is-active' : '') + '">' + escapeHtml(chef.redAmberCount ? ('红色心法盘X' + chef.redAmberCount) : '无红色心法盘') + '</span>' : '',
                    '</div>',
                    '<div class="collection-team-chef-details">', getHighlightedCollectionDetailsHtml(chef), '</div>',
                '</div>',
                '<div class="collection-team-chef-subrow">',
                    isLabArea ? [
                        '<span class="collection-team-chef-origin">来源: ', originHtml, '</span>',
                        chef.isUltimate ? '<span class="collection-team-chef-badge">已修炼</span>' : ''
                    ].join('') : [
                        '<div class="collection-team-chef-stats">',
                            '<span class="collection-team-chef-stat collection-team-chef-stat-material">素材:', escapeHtml(String(chef.materialGain)), '%</span>',
                            '<span class="collection-team-chef-stat collection-team-chef-stat-crit-material">暴击素材:', escapeHtml(String(chef.critMaterial)), '%</span>',
                            '<span class="collection-team-chef-stat collection-team-chef-stat-crit">暴击率:', escapeHtml(String(chef.critChance)), '%</span>',
                        '</div>',
                        chef.isUltimate ? '<span class="collection-team-chef-badge">已修炼</span>' : ''
                    ].join(''),
                '</div>',
            '</div>'
        ].join('');
    }

    // 从实验室详情文本中回算“基础技法+光环加成”的总和。
    function getLabCombinationTotalSkill(combination) {
        return combination.chefs.reduce(function(total, chef) {
            var details = String(chef.collectionDetails || '');
            var baseMatch = details.match(/技法值[:：]\s*(\d+)/);
            var auraMatch = details.match(/=\s*(\d+)\s*[）)]/);
            var baseValue = baseMatch ? toInt(baseMatch[1], 0) : 0;
            var auraValue = auraMatch ? toInt(auraMatch[1], 0) : 0;
            return total + baseValue + auraValue;
        }, 0);
    }

    // 生成“组合详情”弹窗HTML。
    function getCombinationDetailsDialogHtml(combination) {
        var titleText = isLabAreaName(combination.areaName) ? (combination.areaName + '：' + getLabCombinationTotalSkill(combination) + ' - 组合详情') : (combination.areaName + ' - 组合详情');
        var chefHtml = combination.chefs.length ? combination.chefs.map(function(chef) {
            return getSavedChefRowHtml(chef);
        }).join('') : '<div class="collection-team-detail-empty">该编队暂无厨师数据</div>';

        return [
            '<div class="collection-team-detail-dialog">',
                '<div class="collection-team-detail-title">', escapeHtml(titleText), '</div>',
                '<div class="collection-team-detail-time">保存时间: ', escapeHtml(formatSavedTime(combination.savedTime, true)), '</div>',
                '<div class="collection-team-detail-list">', chefHtml, '</div>',
            '</div>'
        ].join('');
    }

    // 打开组合详情弹窗。
    function showCombinationDetailsDialog(combination) {
        bootbox.dialog({
            title: '编队详情',
            className: 'collection-team-detail-modal',
            backdrop: true,
            onEscape: true,
            message: getCombinationDetailsDialogHtml(combination),
            buttons: {}
        });
    }

    // 生成“查看方案”列表HTML。
    function getSavedSchemeListHtml(schemes) {
        if (!schemes.length) {
            return '<div class="collection-team-empty">暂无保存方案</div>';
        }
        return schemes.map(function(item, index) {
            var combinations = toArray(item.combinations);
            var areaNames = combinations.map(function(combo) {
                return combo && (combo.areaName || combo.name || combo.area);
            }).filter(function(name) {
                return !!name;
            });
            return [
                '<div class="collection-team-scheme-item">',
                    '<div class="collection-team-scheme-main">',
                        '<div class="collection-team-scheme-title">', escapeHtml(item.name), '</div>',
                        '<div class="collection-team-scheme-meta">', combinations.length, ' 个编队 · ', escapeHtml(formatSavedTime(parseSavedTime(item.savedTime || item.time), false)), '</div>',
                        '<div class="collection-team-scheme-areas">', escapeHtml(areaNames.join('、') || '暂无地区'), '</div>',
                    '</div>',
                    '<div class="collection-team-scheme-actions">',
                        '<button type="button" class="btn btn-default collection-team-scheme-btn" data-action="apply-scheme" data-index="', index, '">应用</button>',
                        '<button type="button" class="btn btn-default collection-team-scheme-btn collection-team-scheme-delete" data-action="delete-scheme" data-index="', index, '">删除</button>',
                    '</div>',
                '</div>'
            ].join('');
        }).join('');
    }

    // 打开方案管理弹窗（应用/删除）。
    function showSavedSchemeListDialog(onApplied) {
        var schemes = loadSavedCombinationSchemes();
        var dialog = bootbox.dialog({
            title: '查看方案',
            className: 'collection-team-scheme-modal',
            backdrop: true,
            onEscape: true,
            message: '<div class="collection-team-scheme-dialog"><div class="collection-team-scheme-list">' + getSavedSchemeListHtml(schemes) + '</div></div>',
            buttons: {}
        });

        // 方案列表局部刷新。
        function renderSchemeDialog() {
            dialog.find('.bootbox-body').html('<div class="collection-team-scheme-dialog"><div class="collection-team-scheme-list">' + getSavedSchemeListHtml(schemes) + '</div></div>');
        }

        dialog.on('click', '[data-action="apply-scheme"]', function() {
            var index = toInt($(this).data('index'), -1);
            var scheme = schemes[index];
            var savedAreaNames;
            var enabledItems;
            if (!scheme) {
                return;
            }
            bootbox.confirm({
                title: '确认应用方案',
                backdrop: true,
                onEscape: true,
                message: '<div class="collection-team-delete-confirm">应用后会覆盖当前已保存编队，确定继续吗？</div>',
                buttons: {
                    confirm: {
                        label: '应用',
                        className: 'btn-primary'
                    },
                    cancel: {
                        label: '取消',
                        className: 'btn-default'
                    }
                },
                callback: function(result) {
                    if (!result) {
                        return;
                    }
                    saveSavedCombinationRawList(JSON.parse(JSON.stringify(toArray(scheme.combinations))));
                    savedAreaNames = getSavedAreaNames();
                    enabledItems = getEnabledAreaItems(savedAreaNames);
                    syncUnifiedAreaOrder(savedAreaNames, enabledItems);
                    scheduleSortCacheRefresh();
                    dialog.modal('hide');
                    if (typeof onApplied === 'function') {
                        onApplied();
                    }
                }
            });
        });

        dialog.on('click', '[data-action="delete-scheme"]', function() {
            var index = toInt($(this).data('index'), -1);
            var scheme = schemes[index];
            if (!scheme) {
                return;
            }
            bootbox.confirm({
                title: '确认删除',
                backdrop: true,
                onEscape: true,
                message: '<div class="collection-team-delete-confirm">确定删除方案“' + escapeHtml(scheme.name) + '”吗？</div>',
                buttons: {
                    confirm: {
                        label: '删除',
                        className: 'btn-danger'
                    },
                    cancel: {
                        label: '取消',
                        className: 'btn-default'
                    }
                },
                callback: function(result) {
                    if (!result) {
                        return;
                    }
                    schemes.splice(index, 1);
                    saveSavedCombinationSchemes(schemes);
                    renderSchemeDialog();
                }
            });
        });
    }

    // 构造“查看编队”弹窗主体HTML（分组Tab + 批量操作）。
    function getSavedCombinationsDialogHtml(combinations, selectedAreaKey, selectedIds) {
        var filteredItems = combinations.filter(function(item) {
            return item.areaGroupKey === selectedAreaKey;
        });
        var allSelected = filteredItems.length > 0 && filteredItems.every(function(item) {
            return !!selectedIds[item.id];
        });
        var tabsHtml = AREA_GROUP_ORDER.map(function(groupKey) {
            var count = combinations.filter(function(item) {
                return item.areaGroupKey === groupKey;
            }).length;
            return [
                '<button type="button" class="collection-team-tab',
                groupKey === selectedAreaKey ? ' is-active' : '',
                '" data-action="switch-team-tab" data-group="', escapeHtml(groupKey), '">',
                '<span>', escapeHtml(AREA_GROUP_TITLES[groupKey]), '</span>',
                '<span class="collection-team-tab-count">', count, '</span>',
                '</button>'
            ].join('');
        }).join('');
        var listHtml = filteredItems.length ? filteredItems.map(function(item) {
            return [
                '<div class="collection-team-item">',
                    '<label class="collection-team-item-check">',
                        '<input type="checkbox" data-action="toggle-team-selection" data-id="', escapeHtml(item.id), '"', selectedIds[item.id] ? ' checked' : '', '>',
                    '</label>',
                    '<div class="collection-team-item-main">',
                        '<div class="collection-team-item-title">', escapeHtml(item.areaName), '（', item.chefs.length, '个厨师）</div>',
                        '<div class="collection-team-item-time">保存时间: ', escapeHtml(formatSavedTime(item.savedTime, false)), '</div>',
                    '</div>',
                    '<button type="button" class="btn btn-default collection-team-item-detail-btn" data-action="view-team-detail" data-id="', escapeHtml(item.id), '">查看详情</button>',
                '</div>'
            ].join('');
        }).join('') : '<div class="collection-team-empty">该区域暂无保存的编队</div>';

        return [
            '<div class="collection-team-saved-dialog">',
                '<div class="collection-team-tabs-shell">', tabsHtml, '</div>',
                '<div class="collection-team-toolbar">',
                    '<div class="collection-team-toolbar-count">已选 ', getSelectedCombinationCount(selectedIds), ' 项</div>',
                '</div>',
                '<div class="collection-team-saved-list">', listHtml, '</div>',
                '<div class="collection-team-dialog-footer">',
                    '<div class="collection-team-dialog-footer-left">',
                        '<button type="button" class="btn btn-default collection-team-footer-btn" data-action="toggle-select-all"', filteredItems.length ? '' : ' disabled', '>', allSelected ? '取消全选' : '全选', '</button>',
                        '<button type="button" class="btn btn-default collection-team-footer-btn collection-team-toolbar-delete" data-action="delete-selected"', getSelectedCombinationCount(selectedIds) ? '' : ' disabled', '>删除</button>',
                        '<button type="button" class="btn btn-default collection-team-footer-btn" data-action="save-scheme"', getSelectedCombinationCount(selectedIds) ? '' : ' disabled', '>保存方案</button>',
                        '<button type="button" class="btn btn-default collection-team-footer-btn" data-action="view-schemes">查看方案</button>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // 打开已保存编队弹窗，支持删除/保存方案/查看详情。
    function showSavedCombinationsDialog() {
        var bundle = loadSavedCombinationBundle();
        var combinations = bundle.items.slice();
        var rawList = bundle.rawList.slice();
        var selectedAreaKey = 'veg';
        var selectedIds = {};
        var dialog = bootbox.dialog({
            title: '查看编队',
            className: 'collection-team-saved-modal',
            backdrop: true,
            onEscape: true,
            message: getSavedCombinationsDialogHtml(combinations, selectedAreaKey, selectedIds),
            buttons: {}
        });

        // 局部刷新弹窗内容。
        function renderSavedDialog() {
            dialog.find('.bootbox-body').html(getSavedCombinationsDialogHtml(combinations, selectedAreaKey, selectedIds));
        }

        // 重新从存储加载并刷新弹窗，处理外部变更。
        function reloadSavedDialog() {
            bundle = loadSavedCombinationBundle();
            rawList = bundle.rawList.slice();
            combinations = bundle.items.slice();
            if (!combinations.some(function(item) {
                return item.areaGroupKey === selectedAreaKey;
            })) {
                selectedAreaKey = combinations.length ? combinations[0].areaGroupKey : 'veg';
            }
            renderSavedDialog();
        }

        // 按id查找当前弹窗中的组合。
        function findCombinationById(id) {
            var matched = null;
            combinations.some(function(item) {
                if (item.id === id) {
                    matched = item;
                    return true;
                }
                return false;
            });
            return matched;
        }

        dialog.on('click', '[data-action="switch-team-tab"]', function() {
            selectedAreaKey = $(this).data('group');
            renderSavedDialog();
        });

        dialog.on('change', '[data-action="toggle-team-selection"]', function() {
            var id = $(this).data('id');
            if ($(this).prop('checked')) {
                selectedIds[id] = true;
            } else {
                delete selectedIds[id];
            }
            renderSavedDialog();
        });

        dialog.on('click', '[data-action="toggle-select-all"]', function() {
            var filteredItems = combinations.filter(function(item) {
                return item.areaGroupKey === selectedAreaKey;
            });
            var allSelected = filteredItems.length > 0 && filteredItems.every(function(item) {
                return !!selectedIds[item.id];
            });

            filteredItems.forEach(function(item) {
                if (allSelected) {
                    delete selectedIds[item.id];
                } else {
                    selectedIds[item.id] = true;
                }
            });
            renderSavedDialog();
        });

        dialog.on('click', '[data-action="delete-selected"]', function() {
            var selectedItems = combinations.filter(function(item) {
                return !!selectedIds[item.id];
            });

            if (!selectedItems.length) {
                if (typeof window.showAlert === 'function') {
                    window.showAlert('未选择任何编队');
                }
                return;
            }

            bootbox.confirm({
                title: '确认删除',
                backdrop: true,
                onEscape: true,
                message: '<div class="collection-team-delete-confirm">确定删除已选择的 ' + selectedItems.length + ' 个编队吗？</div>',
                buttons: {
                    confirm: {
                        label: '删除',
                        className: 'btn-danger'
                    },
                    cancel: {
                        label: '取消',
                        className: 'btn-default'
                    }
                },
                callback: function(result) {
                    var selectedIndexMap;
                    var savedAreaNames;
                    var enabledItems;
                    if (!result) {
                        return;
                    }

                    selectedIndexMap = {};
                    selectedItems.forEach(function(item) {
                        selectedIndexMap[item.storageIndex] = true;
                    });

                    rawList = rawList.filter(function(item, index) {
                        return !selectedIndexMap[index];
                    });
                    saveSavedCombinationRawList(rawList);
                    selectedIds = {};

                    savedAreaNames = getSavedAreaNames();
                    enabledItems = getEnabledAreaItems(savedAreaNames);
                    syncUnifiedAreaOrder(savedAreaNames, enabledItems);
                    scheduleSortCacheRefresh();
                    reloadSavedDialog();
                }
            });
        });

        dialog.on('click', '[data-action="view-team-detail"]', function() {
            var combination = findCombinationById($(this).data('id'));
            if (combination) {
                showCombinationDetailsDialog(combination);
            }
        });

        dialog.on('click', '[data-action="save-scheme"]', function() {
            var selectedItems = combinations.filter(function(item) {
                return !!selectedIds[item.id];
            });
            if (!selectedItems.length) {
                if (typeof window.showAlert === 'function') {
                    window.showAlert('请先选择要保存的编队');
                }
                return;
            }
            bootbox.prompt({
                title: '保存方案',
                inputType: 'text',
                backdrop: true,
                onEscape: true,
                placeholder: '请输入方案名称',
                buttons: {
                    confirm: {
                        label: '保存',
                        className: 'btn-primary'
                    },
                    cancel: {
                        label: '取消',
                        className: 'btn-default'
                    }
                },
                callback: function(name) {
                    var schemes;
                    var trimmedName;
                    if (!name) {
                        return;
                    }
                    trimmedName = String(name).trim();
                    if (!trimmedName) {
                        return;
                    }
                    schemes = loadSavedCombinationSchemes();
                    schemes.push({
                        id: 'collection_scheme_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
                        name: trimmedName,
                        savedTime: Date.now(),
                        combinations: selectedItems.map(function(item) {
                            return JSON.parse(JSON.stringify(item.raw));
                        })
                    });
                    saveSavedCombinationSchemes(schemes);
                    if (typeof window.showAlert === 'function') {
                        window.showAlert('方案已保存', '成功');
                    }
                }
            });
        });

        dialog.on('click', '[data-action="view-schemes"]', function() {
            showSavedSchemeListDialog(function() {
                selectedIds = {};
                reloadSavedDialog();
            });
        });
    }

    // 深拷贝工具（查询流程里会多次克隆厨师防止互相污染）。
    function cloneData(value) {
        if (value === null || typeof value === 'undefined') {
            return value;
        }
        return JSON.parse(JSON.stringify(value));
    }

    // 汇总已保存编队中的厨师名集合，查询时用于排除已占用厨师。
    function getSavedCombinationChefNameSet() {
        var nameSet = {};
        loadSavedCombinationBundle().items.forEach(function(item) {
            item.chefs.forEach(function(chef) {
                if (chef && chef.name) {
                    nameSet[chef.name] = true;
                }
            });
        });
        return nameSet;
    }

    // 从 localData 构建“已拥有厨师”映射，支持 onlyOwned 过滤。
    function getOwnedChefState(localData) {
        var ownedMap = {};
        var hasOwnedMarks = false;

        if (!localData || !Array.isArray(localData.chefs)) {
            return {
                map: ownedMap,
                hasOwnedMarks: false
            };
        }

        localData.chefs.forEach(function(item) {
            if (!item || (!item.id && !item.chefId)) {
                return;
            }
            if (item.got === '是' || item.got === true || item.got === 1 || item.got === '1') {
                ownedMap[String(item.id || item.chefId)] = true;
                hasOwnedMarks = true;
            }
        });

        return {
            map: ownedMap,
            hasOwnedMarks: hasOwnedMarks
        };
    }

    // 读取当前查询上下文（规则、开关、本地数据、筛选条件）。
    function getCurrentCollectionContext() {
        var rule = window.calCustomRule && window.calCustomRule.rules && window.calCustomRule.rules[0];
        var gameData = window.calCustomRule && window.calCustomRule.gameData;
        if (!rule || !Array.isArray(rule.chefs)) {
            return null;
        }
        return {
            rule: rule,
            gameData: gameData || null,
            localData: typeof window.getLocalData === 'function' ? window.getLocalData() : {},
            applyEquip: $('#chk-cal-use-equip').prop('checked'),
            applyUltimate: $('#chk-chef-apply-ultimate').length ? $('#chk-chef-apply-ultimate').prop('checked') : true,
            applyUltimatePerson: $('#chk-chef-apply-ultimate-person').length ? $('#chk-chef-apply-ultimate-person').prop('checked') : true,
            applyAmbers: $('#chk-cal-use-amber').prop('checked'),
            maxDiskLevel: $('#chk-cal-max-disk').prop('checked'),
            onlyOwned: $('#chk-cal-got').prop('checked'),
            onlyUltimated: $('#chk-cal-ultimated').prop('checked'),
            partialUltimateIds: $('#chk-chef-partial-ultimate').val()
        };
    }

    // 把本地配置（厨具/心法盘/等级）应用到厨师对象，作为查询前置处理。
    function applyLocalChefDataForQuery(chef, context) {
        var localData = context.localData;
        var slots;

        if (typeof window.updateChefByLocalData === 'function') {
            window.updateChefByLocalData(
                chef,
                localData || {},
                context.rule.equips || context.gameData.equips || [],
                context.rule.ambers || context.gameData.ambers || []
            );
        }

        if (!context.applyEquip) {
            chef.equip = null;
            chef.equipId = '';
            chef.equipDisp = '';
        }

        if (chef.disk && Array.isArray(chef.disk.ambers)) {
            slots = chef.disk.ambers;
            if (!context.applyAmbers) {
                slots.forEach(function(slot) {
                    if (slot) {
                        slot.data = null;
                    }
                });
            }
            if (context.maxDiskLevel) {
                chef.disk.level = chef.disk.maxLevel || chef.disk.level || 1;
            }
        }
    }

    // 按配置尝试把厨师厨具替换为银布鞋（菜地区/玉片区）。
    // 返回 true 表示厨具发生变化，需要重算厨师数据。
    function applySilverShoesIfNeeded(chef, context, areaPrefix) {
        // 根据区域类型读取对应的银布鞋配置
        var useSilverShoes = false;
        if (areaPrefix === 'veg') {
            useSilverShoes = loadBooleanSetting('useSilverShoes', false);
        } else if (areaPrefix === 'jade') {
            useSilverShoes = loadBooleanSetting('useJadeSilverShoes', false);
        }

        if (!useSilverShoes || !context.applyEquip) {
            return false;
        }

        // 检查厨师当前佩戴的厨具（与 show 项目保持一致：支持数字/字符串 ID）
        var currentEquipId = chef.__originalEquipId;
        if (currentEquipId === null || typeof currentEquipId === 'undefined' || currentEquipId === '') {
            if (chef.__originalEquip && chef.__originalEquip.equipId) {
                currentEquipId = chef.__originalEquip.equipId;
            } else if (chef.equip && chef.equip.equipId) {
                currentEquipId = chef.equip.equipId;
            } else {
                currentEquipId = chef.equipId || '';
            }
        }
        currentEquipId = String(currentEquipId || '');
        var specialEquipIds = ['1088', '76', '77', '78', '64', '841'];

        // 如果是特殊厨具ID，不替换
        if (currentEquipId && specialEquipIds.indexOf(currentEquipId) >= 0) {
            return false;
        }

        // 使用65号厨具（银布鞋）
        var silverShoes = getEquipById(context, '65');
        if (silverShoes) {
            chef.equip = silverShoes;
            chef.equipId = silverShoes.equipId || '65';
            chef.equipDisp = silverShoes.disp || '银布鞋';
            return true;
        }

        return false;
    }

    // 按实验室配置应用150或100厨具（互斥策略）。
    // 返回 true 表示厨具发生变化。
    function applyLabEquipIfNeeded(chef, context, areaName) {
        var useLabEquip150 = loadBooleanSetting('useLabEquip150', false);
        var useBeginnerEquip100 = loadBooleanSetting('useBeginnerEquip100', false);

        if (!context.applyEquip) {
            return false;
        }

        // 150厨具优先
        if (useLabEquip150) {
            var equip150 = getLabEquip150(context, areaName);
            if (equip150) {
                chef.equip = equip150;
                chef.equipId = equip150.equipId;
                chef.equipDisp = equip150.disp;
                return true;
            }
        }

        // 100新手厨具
        if (useBeginnerEquip100) {
            var equip100 = getLabEquip100(context, areaName);
            if (equip100) {
                chef.equip = equip100;
                chef.equipId = equip100.equipId;
                chef.equipDisp = equip100.disp;
                return true;
            }
        }

        return false;
    }

    // 统一调用 setDataForChef 进行重算，确保技能/厨具/心法盘效果生效。
    function recalculateChefData(chef, chefPoolData) {
        if (typeof window.setDataForChef === 'function') {
            window.setDataForChef(
                chef,
                chef.equip || null,
                chefPoolData.context.applyEquip,
                chefPoolData.ultimateData.global || [],
                chefPoolData.partialAdds,
                chefPoolData.ultimateData.self || [],
                null,
                true,
                null,
                chefPoolData.context.applyAmbers,
                chefPoolData.ultimateData.qixia || null
            );
        }
    }

    // 在规则或gameData中按ID查找厨具。
    function getEquipById(context, equipId) {
        var equips = context.rule.equips || context.gameData.equips || [];
        for (var i = 0; i < equips.length; i++) {
            if (String(equips[i].equipId) === String(equipId)) {
                return equips[i];
            }
        }
        return null;
    }

    // 获取实验室对应技法的150厨具。
    function getLabEquip150(context, areaName) {
        // 根据地区名称确定技法类型，然后找到对应的150厨具
        var equipIdMap = {
            '炒技法': '190',
            '蒸技法': '193',
            '烤技法': '199',
            '煮技法': '202',
            '炸技法': '205',
            '切技法': '208',
            // 支持不带"技法"后缀的地区名称
            '炒': '190',
            '蒸': '193',
            '烤': '199',
            '煮': '202',
            '炸': '205',
            '切': '208'
        };

        var equipId = equipIdMap[areaName];
        if (!equipId) {
            return null;
        }

        return getEquipById(context, equipId);
    }

    // 获取实验室对应技法的100新手厨具。
    function getLabEquip100(context, areaName) {
        // 根据地区名称确定技法类型，然后找到对应的100新手厨具
        var equipIdMap = {
            '炒技法': '4',
            '蒸技法': '13',
            '烤技法': '1',
            '煮技法': '16',
            '炸技法': '10',
            '切技法': '7',
            // 支持不带"技法"后缀的地区名称
            '炒': '4',
            '蒸': '13',
            '烤': '1',
            '煮': '16',
            '炸': '10',
            '切': '7'
        };

        var equipId = equipIdMap[areaName];
        if (!equipId) {
            return null;
        }

        return getEquipById(context, equipId);
    }

    // 汇总厨师素材相关元数据：
    // - materialGain（基础+对应类型加成）
    // - critChance / critMaterial（厨师+修炼+厨具）
    // - 价格加成、稀客、开业时间等辅助标记
    // 说明：厨具效果会先通过 updateEquipmentEffect 与自我修炼联动后再统计，确保与页面展示口径一致。
    function getChefMaterialSkillMeta(chef) {
        var materialGainBase = 0;
        var materialGainMeat = 0;
        var materialGainFish = 0;
        var materialGainVeg = 0;
        var materialGainCreation = 0;
        var critMaterial = 0;
        var critChance = 0;
        var priceBonus = 0;
        var hasRareGuestSkill = false;
        var hasOpeningTimeSkill = false;

        // 判断描述是否是“概率额外获得素材”类暴击技能。
        function isCritMaterialSkillDesc(desc) {
            var text = String(desc || '');
            return /(\d+)%概率额外获得(-?\d+)%(?:的)?素材/.test(text);
        }

        // 从技能文本中解析暴击率与暴击素材。
        function parseCritSkillFromDesc(desc) {
            var text = String(desc || '');
            var regex = /(\d+)%概率额外获得(-?\d+)%(?:的)?素材/g;
            var match;
            var totalChance = 0;
            var totalMaterial = 0;

            while ((match = regex.exec(text)) !== null) {
                totalChance += toInt(match[1], 0);
                totalMaterial += toInt(match[2], 0);
            }

            return {
                chance: totalChance,
                material: totalMaterial
            };
        }

        // 从效果数组统计 Material_Gain 数值。
        function getMaterialGainFromEffects(effects) {
            var total = 0;
            (effects || []).forEach(function(effect) {
                if (effect && String(effect.type || '') === 'Material_Gain') {
                    total += toInt(effect.value, 0);
                }
            });
            return total;
        }

        // 合并“文本解析”和“effect解析”的暴击数据，取更可靠的素材值。
        function parseCritSkill(desc, effects) {
            var parsed = parseCritSkillFromDesc(desc);
            var effectMaterial = getMaterialGainFromEffects(effects);

            if (parsed.chance > 0 && Math.abs(effectMaterial) > Math.abs(parsed.material)) {
                parsed.material = effectMaterial;
            }

            return parsed;
        }

        // 获取厨具生效后的 effect（考虑修炼对厨具技能的放大）。
        function getEffectiveEquipEffects() {
            var equipEffects = chef && chef.equip && chef.equip.effect ? chef.equip.effect : [];
            if (typeof window.updateEquipmentEffect === 'function' && Array.isArray(equipEffects) && equipEffects.length && Array.isArray(chef.selfUltimateEffect) && chef.selfUltimateEffect.length) {
                return window.updateEquipmentEffect(equipEffects, chef.selfUltimateEffect) || equipEffects;
            }
            return equipEffects;
        }

        // 扫描effect列表，累加素材/售价/标签类元信息。
        function scanEffects(effects, sourceDesc) {
            var isCritSource = isCritMaterialSkillDesc(sourceDesc);
            (effects || []).forEach(function(effect) {
                var effectType;
                var effectValue;
                if (!effect) {
                    return;
                }
                effectType = String(effect.type || '');
                effectValue = toInt(effect.value, 0);
                if (effectType === 'Material_Gain') {
                    if (!isCritSource) {
                        materialGainBase += effectValue;
                    }
                } else if (effectType === 'Material_Meat') {
                    materialGainMeat += effectValue;
                } else if (effectType === 'Material_Fish') {
                    materialGainFish += effectValue;
                } else if (effectType === 'Material_Vegetable') {
                    materialGainVeg += effectValue;
                } else if (effectType === 'Material_Creation') {
                    materialGainCreation += effectValue;
                } else if (effectType === 'UseAll' || effectType === 'Price') {
                    priceBonus += effectValue;
                } else if (effectType.indexOf('RareGuest') >= 0) {
                    hasRareGuestSkill = true;
                } else if (effectType === 'OpenTime' || effectType === 'CookbookTime') {
                    hasOpeningTimeSkill = true;
                }
            });
        }

        // 根据地区推断当前查询目标素材类型。
        function getTargetTypeFromAreaName(areaName) {
            if (areaName === '池塘') {
                return 'fish';
            }
            if (areaName === '牧场' || areaName === '猪圈' || areaName === '鸡舍') {
                return 'meat';
            }
            if (areaName === '菜棚' || areaName === '菜地' || areaName === '森林') {
                return 'veg';
            }
            return 'creation';
        }

        var effectiveEquipEffects = getEffectiveEquipEffects();

        scanEffects(chef.specialSkillEffect, chef.specialSkillDisp);
        scanEffects(effectiveEquipEffects, chef.equip && (chef.equip.skillDisp || chef.equip.desc || ''));

        if (chef.disk && Array.isArray(chef.disk.ambers)) {
            chef.disk.ambers.forEach(function(slot) {
                var levelEffects;
                if (!slot || !slot.data || !slot.data.allEffect) {
                    return;
                }
                levelEffects = slot.data.allEffect[(chef.disk.level || 1) - 1] || [];
                scanEffects(levelEffects, '');
            });
        }

        var chefCrit = parseCritSkill(String(chef.specialSkillDisp || ''), chef.specialSkillEffect);
        var ultimateCrit = parseCritSkill(String(chef.ultimateSkillDisp || ''), chef.ultimateSkillEffect);
        var equipCrit = parseCritSkill(String(chef.equip && (chef.equip.skillDisp || chef.equip.desc || '') || ''), effectiveEquipEffects);

        chefCrit.chance += ultimateCrit.chance;
        chefCrit.material += ultimateCrit.material;

        if (equipCrit.chance > chefCrit.chance) {
            critChance = equipCrit.chance;
            critMaterial = equipCrit.material;
        } else if (chefCrit.chance > 0) {
            critChance = chefCrit.chance;
            critMaterial = chefCrit.material;
        } else {
            (chef.ultimateSkillEffect || []).some(function(effect) {
                var matched;
                if (!effect || effect.type !== 'Material_Gain') {
                    return false;
                }
                critMaterial = toInt(effect.value, 0);
                matched = String(chef.ultimateSkillDisp || '').match(/(\d+)%/);
                critChance = matched ? toInt(matched[1], 0) : 0;
                return true;
            });
        }

        var targetType = getTargetTypeFromAreaName(String(chef.__queryAreaName || ''));
        var typedGain = 0;
        if (targetType === 'meat') {
            typedGain = materialGainMeat;
        } else if (targetType === 'fish') {
            typedGain = materialGainFish;
        } else if (targetType === 'veg') {
            typedGain = materialGainVeg;
        } else if (targetType === 'creation') {
            typedGain = materialGainCreation;
        }

        return {
            materialGain: materialGainBase + typedGain,
            materialGainBase: materialGainBase,
            materialGainMeat: materialGainMeat,
            materialGainFish: materialGainFish,
            materialGainVeg: materialGainVeg,
            materialGainCreation: materialGainCreation,
            targetType: targetType,
            typedGain: typedGain,
            critMaterial: critMaterial,
            critChance: critChance,
            priceBonus: priceBonus,
            hasRareGuestSkill: hasRareGuestSkill,
            hasOpeningTimeSkill: hasOpeningTimeSkill,
            redAmberCount: chef.disk && Array.isArray(chef.disk.ambers) ? chef.disk.ambers.filter(function(slot) {
                return slot && slot.type === 1 && slot.data;
            }).length : 0
        };
    }

    // 采集期望值口径：素材 + 暴击率 * 暴击素材。
    function getCollectionExpectation(meta) {
        meta = meta || {};
        return (meta.materialGain || 0) + ((meta.critChance || 0) / 100 * (meta.critMaterial || 0));
    }

    // 菜地候选保护规则：用于排序时降低被替换概率（与旧逻辑保持一致）。
    function isProtectedVegChef(chef, metric) {
        var meta = metric && metric.meta ? metric.meta : (chef.__queryMeta || {});
        var hasCollectionSkill = (meta.materialGain || 0) > 0 || ((meta.critMaterial || 0) > 0 && (meta.critChance || 0) > 10);
        var rarity = toInt(chef.rarity, 0);
        return (rarity >= 4 && !hasCollectionSkill) || (rarity <= 3 && (meta.priceBonus || 0) >= 30) || !!meta.hasRareGuestSkill;
    }

    // 取四项采集值前两名之和（菜地兜底替换策略用）。
    function getChefTopTwoCollectionSum(chef) {
        var values = [
            toInt(chef.meatVal, 0),
            toInt(chef.fishVal, 0),
            toInt(chef.vegVal, 0),
            toInt(chef.creationVal, 0)
        ].sort(function(left, right) {
            return right - left;
        });
        return (values[0] || 0) + (values[1] || 0);
    }

    function getChefUltimateSkillDescriptions(chef, context) {
        var skillIds = chef && chef.ultimateSkillList ? chef.ultimateSkillList : [];
        var skills = context && context.gameData && context.gameData.skills ? context.gameData.skills : [];
        return skillIds.map(function(skillId) {
            var matched = null;
            skills.some(function(skill) {
                if (String(skill.skillId) === String(skillId)) {
                    matched = String(skill.desc || '');
                    return true;
                }
                return false;
            });
            return matched;
        }).filter(function(desc) {
            return !!desc;
        });
    }

    function createCollectionBonusInfo() {
        return {
            meat: 0,
            fish: 0,
            veg: 0,
            creation: 0
        };
    }

    function addCollectionBonusValue(bonusInfo, typeLabel, value) {
        if (typeLabel === '肉') {
            bonusInfo.meat += value;
        } else if (typeLabel === '鱼') {
            bonusInfo.fish += value;
        } else if (typeLabel === '菜') {
            bonusInfo.veg += value;
        } else if (typeLabel === '面') {
            bonusInfo.creation += value;
        }
    }

    function calculateChefGlobalCollectionBonus(chef, context) {
        var bonusInfo = createCollectionBonusInfo();
        var descriptions;

        if (!chef || !toBoolean(chef.isUltimate || chef.ult || chef.ultimate || chef.cultivated)) {
            return bonusInfo;
        }

        descriptions = getChefUltimateSkillDescriptions(chef, context);
        descriptions.forEach(function(desc) {
            var multiMatch = desc.match(/场上所有厨师(肉|鱼|菜|面)和(肉|鱼|菜|面)各\+(\d+)/);
            var singleMatch = desc.match(/场上所有厨师(肉|鱼|菜|面)(?:类采集|采集)?\+(\d+)/);
            var value;

            if (multiMatch) {
                value = toInt(multiMatch[3], 0);
                addCollectionBonusValue(bonusInfo, multiMatch[1], value);
                addCollectionBonusValue(bonusInfo, multiMatch[2], value);
                return;
            }

            if (singleMatch) {
                value = toInt(singleMatch[2], 0);
                addCollectionBonusValue(bonusInfo, singleMatch[1], value);
            }
        });

        return bonusInfo;
    }

    function applyAreaTeamCollectionBonus(selected, areaItem, context) {
        var totalBonus = createCollectionBonusInfo();
        var totalValue = 0;

        if (!selected || !selected.length || !areaItem || (areaItem.prefix !== 'veg' && areaItem.prefix !== 'jade')) {
            return {
                selected: selected || [],
                totalValue: 0
            };
        }

        selected.forEach(function(item) {
            if (isEmptyCollectionChef(item)) {
                return;
            }
            var chefBonus = calculateChefGlobalCollectionBonus(item, context);
            totalBonus.meat += chefBonus.meat;
            totalBonus.fish += chefBonus.fish;
            totalBonus.veg += chefBonus.veg;
            totalBonus.creation += chefBonus.creation;
        });

        selected.forEach(function(item) {
            var jadeTarget;
            if (isEmptyCollectionChef(item)) {
                item.rawValue = 0;
                return;
            }

            item.meatVal = toInt(item.baseMeatVal, toInt(item.meatVal, 0)) + totalBonus.meat;
            item.fishVal = toInt(item.baseFishVal, toInt(item.fishVal, 0)) + totalBonus.fish;
            item.vegVal = toInt(item.baseVegVal, toInt(item.vegVal, 0)) + totalBonus.veg;
            item.creationVal = toInt(item.baseCreationVal, toInt(item.creationVal, 0)) + totalBonus.creation;

            if (areaItem.prefix === 'veg') {
                if (areaItem.name === '池塘') {
                    item.rawValue = item.fishVal;
                } else if (areaItem.name === '牧场' || areaItem.name === '猪圈' || areaItem.name === '鸡舍') {
                    item.rawValue = item.meatVal;
                } else if (areaItem.name === '菜棚' || areaItem.name === '菜地' || areaItem.name === '森林') {
                    item.rawValue = item.vegVal;
                } else {
                    item.rawValue = item.creationVal;
                }
            } else {
                jadeTarget = getJadeTargetConfig(areaItem.name);
                item.rawValue = jadeTarget.keys.reduce(function(sum, key) {
                    if (key === 'meatVal') {
                        return sum + item.meatVal;
                    }
                    if (key === 'fishVal') {
                        return sum + item.fishVal;
                    }
                    if (key === 'vegVal') {
                        return sum + item.vegVal;
                    }
                    if (key === 'creationVal') {
                        return sum + item.creationVal;
                    }
                    return sum;
                }, 0);
            }

            totalValue += item.rawValue;
        });

        return {
            selected: selected,
            totalValue: totalValue
        };
    }

    // 判断厨师是否“已拥有”（支持本地标记与规则数据混用）。
    function isChefOwnedForQuery(chef, ownedState) {
        var chefId = String(chef.chefId || chef.id || '');
        if (chef.got === true || chef.got === '是' || chef.got === 1 || chef.got === '1') {
            return true;
        }
        if (!ownedState.hasOwnedMarks) {
            return true;
        }
        return !!ownedState.map[chefId];
    }

    // 判断厨师是否“已修炼”（支持本地函数兜底）。
    function isChefUltimatedForQuery(chef, context) {
        if (chef.ultimate === '是' || chef.ult === '是' || chef.isUltimate === true || chef.cultivated === true) {
            return true;
        }
        if (typeof window.isChefUltimated === 'function') {
            return !!window.isChefUltimated(chef.chefId || chef.id, context.localData);
        }
        return false;
    }

    // 构建查询厨师池：
    // 1) 应用本地数据与筛选条件
    // 2) 排除已保存编队占用厨师
    // 3) 预计算素材元数据 __queryMeta
    function buildCollectionChefPool() {
        var context = getCurrentCollectionContext();
        var ruleChefs;
        var ownedState;
        var savedChefNameSet;
        var ultimateData;
        var partialAdds;
        var chefs = [];

        if (!context) {
            return {
                error: '请先加载计算规则'
            };
        }

        ruleChefs = cloneData(context.rule.chefs) || [];
        ownedState = getOwnedChefState(context.localData);
        savedChefNameSet = getSavedCombinationChefNameSet();
        ultimateData = {
            global: cloneData(context.rule.calGlobalUltimateData) || [],
            self: cloneData(context.rule.calSelfUltimateData) || [],
            qixia: cloneData(context.rule.calQixiaData) || null
        };
        if ((!ultimateData.global.length && !ultimateData.self.length) && context.gameData && typeof window.getUltimateData === 'function') {
            ultimateData = window.getUltimateData(
                ruleChefs,
                context.localData,
                context.applyUltimate,
                context.applyUltimatePerson,
                context.gameData.skills || []
            ) || { global: [], self: [], qixia: null };
        }
        partialAdds = typeof window.getPartialChefAddsByIds === 'function'
            ? window.getPartialChefAddsByIds(ruleChefs, context.applyUltimate, context.partialUltimateIds)
            : [];
        partialAdds = (partialAdds || []).filter(function(effect) {
            var type = String(effect && effect.type || '');
            return type !== 'Meat' && type !== 'Fish' && type !== 'Vegetable' && type !== 'Creation';
        });

        ruleChefs.forEach(function(chef) {
            var meta;
            if (!chef || !chef.name || savedChefNameSet[chef.name]) {
                return;
            }
            applyLocalChefDataForQuery(chef, context);
            if (context.onlyOwned && !isChefOwnedForQuery(chef, ownedState)) {
                return;
            }
            if (context.onlyUltimated && !isChefUltimatedForQuery(chef, context)) {
                return;
            }

            // 保存原始厨具信息，用于后续根据区域类型应用银布鞋逻辑
            chef.__originalEquip = chef.equip ? cloneData(chef.equip) : null;
            chef.__originalEquipId = chef.equipId || '';
            chef.__originalEquipDisp = chef.equipDisp || '';

            if (typeof window.setDataForChef === 'function') {
                window.setDataForChef(
                    chef,
                    chef.equip || null,
                    context.applyEquip,
                    ultimateData.global || [],
                    partialAdds,
                    ultimateData.self || [],
                    null,
                    true,
                    null,
                    context.applyAmbers,
                    ultimateData.qixia || null
                );
            }
            chef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
                ? window.calculateMaterialExpectation(chef, chef.equip || null, chef.disk || {})
                : 0;
            meta = getChefMaterialSkillMeta(chef);
            chef.__queryMeta = meta;
            chefs.push(chef);
        });

        return {
            chefs: chefs,
            context: context,
            ultimateData: ultimateData,
            partialAdds: partialAdds
        };
    }

    // 菜地区目标采集维度映射。
    function getVegTargetConfig(areaName) {
        if (areaName === '池塘') {
            return { label: '鱼', key: 'fishVal' };
        }
        if (areaName === '牧场' || areaName === '猪圈' || areaName === '鸡舍') {
            return { label: '肉', key: 'meatVal' };
        }
        if (areaName === '菜棚' || areaName === '菜地' || areaName === '森林') {
            return { label: '菜', key: 'vegVal' };
        }
        return { label: '面', key: 'creationVal' };
    }

    // 玉片区目标“双采集维度”映射。
    function getJadeTargetConfig(areaName) {
        var configMap = {
            '藏心亭': { label: '肉+菜', keys: ['meatVal', 'vegVal'] },
            '朝阴山': { label: '肉+面', keys: ['meatVal', 'creationVal'] },
            '北冥城': { label: '鱼+面', keys: ['fishVal', 'creationVal'] },
            '清空谷': { label: '肉+鱼', keys: ['meatVal', 'fishVal'] },
            '还寒洞': { label: '菜+面', keys: ['vegVal', 'creationVal'] },
            '永昼宫': { label: '菜+鱼', keys: ['vegVal', 'fishVal'] }
        };
        return configMap[areaName] || { label: '', keys: [] };
    }

    // 检查厨师是否是光环厨师，并返回光环信息
    // 检查实验室光环厨师，并返回光环类型/加成/作用范围。
    function checkAuraChef(chef, skillType, context) {
        // 检查厨师的修炼技能描述
        // foodgame-local 使用 ultimateSkillList 而不是 skills
        var skillIds = chef.ultimateSkillList || chef.skills || [];
        if (!Array.isArray(skillIds) || skillIds.length === 0) {
            return { isAura: false, auraType: '', auraBonus: 0, auraScope: '' };
        }

        var gameData = context && context.gameData;
        if (!gameData || !gameData.skills) {
            return { isAura: false, auraType: '', auraBonus: 0, auraScope: '' };
        }

        var skillDescs = skillIds.map(function(skillId) {
            var skill = gameData.skills.find(function(s) { return s.skillId === skillId; });
            return skill ? skill.desc : '';
        }).filter(function(desc) { return desc; });

        if (skillDescs.length === 0) {
            return { isAura: false, auraType: '', auraBonus: 0, auraScope: '' };
        }

        var combinedDesc = skillDescs.join('\n');

        // 检查是否包含技法加成
        var hasSkillBonus = combinedDesc.indexOf('炒+') >= 0 ||
                           combinedDesc.indexOf('煮+') >= 0 ||
                           combinedDesc.indexOf('切+') >= 0 ||
                           combinedDesc.indexOf('炸+') >= 0 ||
                           combinedDesc.indexOf('烤+') >= 0 ||
                           combinedDesc.indexOf('蒸+') >= 0 ||
                           combinedDesc.indexOf('全技法+') >= 0;

        // 验证是否是光环厨师
        var isAuraChef = (combinedDesc.indexOf('场上所有厨师') >= 0 || combinedDesc.indexOf('下位上场厨师') >= 0) &&
                        (!combinedDesc.indexOf('售价') >= 0 || hasSkillBonus) &&
                        combinedDesc.indexOf('采集') < 0 &&
                        combinedDesc.indexOf('菜') < 0 &&
                        combinedDesc.indexOf('鱼') < 0 &&
                        combinedDesc.indexOf('肉') < 0 &&
                        combinedDesc.indexOf('面') < 0;

        if (!isAuraChef) {
            return { isAura: false, auraType: '', auraBonus: 0, auraScope: '' };
        }

        // 确定光环作用范围
        var auraScope = '';
        if (combinedDesc.indexOf('场上所有厨师') >= 0) {
            auraScope = '场上所有厨师';
        } else if (combinedDesc.indexOf('下位上场厨师') >= 0) {
            auraScope = '下位上场厨师';
        }

        // 优先检查目标技法类型
        if (skillType && (combinedDesc.indexOf(skillType + '技法') >= 0 || combinedDesc.indexOf(skillType + '+') >= 0)) {
            for (var i = 0; i < skillDescs.length; i++) {
                var desc = skillDescs[i];
                if (desc.indexOf(skillType + '技法') >= 0 || desc.indexOf(skillType + '+') >= 0) {
                    var bonus = extractBonusAmount(desc);
                    if (bonus > 0) {
                        return { isAura: true, auraType: skillType, auraBonus: bonus, auraScope: auraScope };
                    }
                }
            }
        }

        // 检查其他技法类型
        var skillTypes = ['蒸', '炸', '炒', '煮', '切', '烤'];
        for (var j = 0; j < skillTypes.length; j++) {
            var type = skillTypes[j];
            if (type === skillType) continue; // 跳过已检查的

            if (combinedDesc.indexOf(type + '技法') >= 0 || combinedDesc.indexOf(type + '+') >= 0) {
                for (var k = 0; k < skillDescs.length; k++) {
                    var desc2 = skillDescs[k];
                    if (desc2.indexOf(type + '技法') >= 0 || desc2.indexOf(type + '+') >= 0) {
                        var bonus2 = extractBonusAmount(desc2);
                        if (bonus2 > 0) {
                            return { isAura: true, auraType: type, auraBonus: bonus2, auraScope: auraScope };
                        }
                    }
                }
            }
        }

        // 检查全技法
        if (combinedDesc.indexOf('全技法+') >= 0) {
            for (var m = 0; m < skillDescs.length; m++) {
                var desc3 = skillDescs[m];
                if (desc3.indexOf('全技法+') >= 0) {
                    var bonus3 = extractBonusAmount(desc3);
                    if (bonus3 > 0) {
                        return { isAura: true, auraType: '全技法', auraBonus: bonus3, auraScope: auraScope };
                    }
                }
            }
        }

        return { isAura: false, auraType: '', auraBonus: 0, auraScope: '' };
    }

    // 从技能描述中提取加成数值
    function extractBonusAmount(desc) {
        var match = desc.match(/\+(\d+)/);
        return match ? toInt(match[1], 0) : 0;
    }

    // 实验室目标技法映射。
    function getLabTargetConfig(areaName) {
        var configMap = {
            '炒': { label: '炒技法', key: 'stirfryVal' },
            '煮': { label: '煮技法', key: 'boilVal' },
            '切': { label: '切技法', key: 'knifeVal' },
            '炸': { label: '炸技法', key: 'fryVal' },
            '烤': { label: '烤技法', key: 'bakeVal' },
            '蒸': { label: '蒸技法', key: 'steamVal' }
        };
        return configMap[areaName] || { label: areaName + '技法', key: 'stirfryVal' };
    }

    // 计算某厨师在指定区域的评分指标：
    // rawValue: 核心采集值/技法值
    // score: 排序分
    // expectation/meta: 采集期望与素材元数据
    function getAreaQueryMetric(areaItem, chef) {
        var rawValue = 0;
        var meta = chef.__queryMeta || { materialGain: 0, critMaterial: 0, critChance: 0, redAmberCount: 0 };
        var score = 0;
        var detailText = '';
        var label = '';
        var expectation = getCollectionExpectation(meta);

        if (areaItem.prefix === 'veg') {
            var vegTarget = getVegTargetConfig(areaItem.name);
            rawValue = toInt(chef[vegTarget.key], 0);
            label = vegTarget.label;
            score = expectation * 1000000 + rawValue * 100 + toInt(chef.rarity, 0);
            detailText = '肉:' + toInt(chef.meatVal, 0) + ' 鱼:' + toInt(chef.fishVal, 0) + ' 菜:' + toInt(chef.vegVal, 0) + ' 面:' + toInt(chef.creationVal, 0);
        } else if (areaItem.prefix === 'jade') {
            var jadeTarget = getJadeTargetConfig(areaItem.name);
            rawValue = jadeTarget.keys.reduce(function(total, key) {
                return total + toInt(chef[key], 0);
            }, 0);
            label = jadeTarget.label;
            score = rawValue * 1000000 + expectation * 1000 + meta.materialGain * 100 + toInt(chef.rarity, 0);
            detailText = label + ':' + rawValue;
        } else if (areaItem.prefix === 'lab') {
            var labTarget = getLabTargetConfig(areaItem.name);
            rawValue = toInt(chef[labTarget.key], 0);
            label = labTarget.label;
            score = rawValue * 1000000 + meta.redAmberCount * 10000 + toInt(chef.rarity, 0) * 100;
            detailText = label + ': ' + rawValue;
        } else {
            label = '调料';
            rawValue = 0;
            score = 0;
            detailText = '功能开发中，敬请期待';
        }

        return {
            rawValue: rawValue,
            score: score,
            label: label,
            detailText: detailText,
            expectation: expectation,
            meta: meta
        };
    }

    // 菜地区候选排序：优先期望值，再看素材与暴击贡献。
    function sortVegCandidates(candidates) {
        return candidates.sort(function(left, right) {
            var leftProtected = isProtectedVegChef(left.chef, left) ? 1 : 0;
            var rightProtected = isProtectedVegChef(right.chef, right) ? 1 : 0;
            var leftCritValue = (left.meta.critChance || 0) * (left.meta.critMaterial || 0);
            var rightCritValue = (right.meta.critChance || 0) * (right.meta.critMaterial || 0);

            if (leftProtected !== rightProtected) {
                return leftProtected - rightProtected;
            }
            if (right.expectation !== left.expectation) {
                return right.expectation - left.expectation;
            }
            if ((right.meta.materialGain || 0) !== (left.meta.materialGain || 0)) {
                return (right.meta.materialGain || 0) - (left.meta.materialGain || 0);
            }
            if (rightCritValue !== leftCritValue) {
                return rightCritValue - leftCritValue;
            }
            if (right.rawValue !== left.rawValue) {
                return right.rawValue - left.rawValue;
            }
            return toInt(right.chef.rarity, 0) - toInt(left.chef.rarity, 0);
        });
    }

    // 判断是否“空位占位厨师”。
    function isEmptyCollectionChef(item) {
        if (!item) {
            return true;
        }
        if (item.isEmpty) {
            return true;
        }
        return !String(item.name || '').trim();
    }

    // 统计已分配真实厨师人数（忽略空位）。
    function getAssignedChefCount(chefs) {
        return (chefs || []).filter(function(chef) {
            return !isEmptyCollectionChef(chef);
        }).length;
    }

    // 生成空位占位对象（替换跨区迁移后用于补位）。
    function createEmptyCollectionChef(areaPrefix) {
        return {
            id: '',
            name: '',
            rarity: 0,
            isUltimate: false,
            ultimateSkillList: [],
            collectionExpectation: 0,
            materialExpectation: 0,
            materialGain: 0,
            critMaterial: 0,
            critChance: 0,
            redAmberCount: 0,
            detailText: '',
            valueLabel: areaPrefix === 'lab' ? '技法值' : '采集点',
            rawValue: 0,
            prefix: areaPrefix || '',
            meatVal: 0,
            fishVal: 0,
            vegVal: 0,
            creationVal: 0,
            baseRawValue: 0,
            baseMeatVal: 0,
            baseFishVal: 0,
            baseVegVal: 0,
            baseCreationVal: 0,
            isEmpty: true
        };
    }

    // 将候选厨师指标封装为查询结果项结构。
    function buildSelectedCollectionChef(item, areaItem) {
        var chef = item.chef;
        var meta = chef.__queryMeta || {};
        return {
            id: chef.chefId || chef.id || chef.name,
            name: chef.name,
            rarity: toInt(chef.rarity, 0),
            isUltimate: toBoolean(chef.isUltimate || chef.ult || chef.ultimate || chef.cultivated),
            ultimateSkillList: cloneData(chef.ultimateSkillList || []),
            collectionExpectation: +(Number(typeof item.expectation === 'number' ? item.expectation : getCollectionExpectation(meta)).toFixed(2)),
            materialExpectation: +(Number(chef.materialExpectation || 0).toFixed(2)),
            materialGain: meta.materialGain || 0,
            critMaterial: meta.critMaterial || 0,
            critChance: meta.critChance || 0,
            redAmberCount: meta.redAmberCount || 0,
            detailText: item.detailText,
            valueLabel: item.label,
            rawValue: item.rawValue,
            baseRawValue: item.rawValue,
            prefix: areaItem.prefix,
            // 添加各项采集点数据（用于菜地区域）
            meatVal: toInt(chef.meatVal, 0),
            fishVal: toInt(chef.fishVal, 0),
            vegVal: toInt(chef.vegVal, 0),
            creationVal: toInt(chef.creationVal, 0),
            baseMeatVal: toInt(chef.meatVal, 0),
            baseFishVal: toInt(chef.fishVal, 0),
            baseVegVal: toInt(chef.vegVal, 0),
            baseCreationVal: toInt(chef.creationVal, 0)
        };
    }

    // 玉片区查询：
    // 仅保留前两项采集维度与地区要求完全匹配的厨师，再按评分排序选人。
    function executeJadeAreaQuery(areaItem, availableChefs, chefPoolData) {
        var jadeTarget = getJadeTargetConfig(areaItem.name);
        var requiredKeys = jadeTarget.keys;

        // 预过滤：只保留前两名采集类型与地区要求完全匹配的厨师
        var matchedCount = 0;
        var matchedChefs = availableChefs.filter(function(chef) {
            // 克隆厨师对象，避免修改原始数据
            var clonedChef = cloneData(chef);

            // 应用银布鞋配置
            var equipChanged = applySilverShoesIfNeeded(clonedChef, chefPoolData.context, 'jade');
            if (equipChanged) {
                // 重新计算厨师数据
                recalculateChefData(clonedChef, chefPoolData);
            }

            // 重新计算材料技能元数据（含心法盘按地区类型加成）
            clonedChef.__queryAreaName = areaItem.name;
            clonedChef.__queryMeta = getChefMaterialSkillMeta(clonedChef);
            clonedChef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
                ? window.calculateMaterialExpectation(clonedChef, clonedChef.equip || null, clonedChef.disk || {})
                : 0;

            // 获取厨师的四种采集值
            var collectionValues = [
                { key: 'meatVal', value: toInt(clonedChef.meatVal, 0) },
                { key: 'fishVal', value: toInt(clonedChef.fishVal, 0) },
                { key: 'vegVal', value: toInt(clonedChef.vegVal, 0) },
                { key: 'creationVal', value: toInt(clonedChef.creationVal, 0) }
            ];

            // 按采集值降序排序，找出前两名
            collectionValues.sort(function(left, right) {
                return right.value - left.value;
            });

            var topTwoKeys = [collectionValues[0].key, collectionValues[1].key].sort();
            var requiredKeysSorted = requiredKeys.slice().sort();

            // 判断前两名是否与地区要求完全匹配
            var isMatched = topTwoKeys[0] === requiredKeysSorted[0] && topTwoKeys[1] === requiredKeysSorted[1];


            if (isMatched) {
                matchedCount++;
                // 如果匹配，用克隆后的厨师替换原始厨师
                Object.assign(chef, clonedChef);
            }

            return isMatched;
        });


        // 对匹配的厨师计算指标并排序
        var candidates = matchedChefs.map(function(chef) {
            var metric = getAreaQueryMetric(areaItem, chef);
            return $.extend({
                chef: chef
            }, metric);
        }).filter(function(item) {
            return item.rawValue > 0;
        }).sort(function(left, right) {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            if (right.rawValue !== left.rawValue) {
                return right.rawValue - left.rawValue;
            }
            return toInt(right.chef.rarity, 0) - toInt(left.chef.rarity, 0);
        });


        var selected = candidates.slice(0, areaItem.people).map(function(item) {
            return buildSelectedCollectionChef(item, areaItem);
        });

        return applyAreaTeamCollectionBonus(selected, areaItem, chefPoolData.context);
    }

    // 实验室查询：
    // 计算基础技法值 + 光环贡献，并按总贡献排序选人。
    function executeLabAreaQuery(areaItem, availableChefs, chefPoolData) {

        // 获取实验室技法类型
        var labTarget = getLabTargetConfig(areaItem.name);
        var skillKey = labTarget.key;
        var skillType = areaItem.name; // 例如："蒸"、"炒"等

        // 计算所有厨师的技法值和光环信息
        var candidates = availableChefs.map(function(chef) {
            // 克隆厨师对象
            var clonedChef = cloneData(chef);

            // 应用实验室厨具配置，传递地区名称
            var equipChanged = applyLabEquipIfNeeded(clonedChef, chefPoolData.context, areaItem.name);
            if (equipChanged) {
                // 重新计算厨师数据
                recalculateChefData(clonedChef, chefPoolData);
            }

            // 重新计算材料技能元数据，确保和当前地区一致
            clonedChef.__queryAreaName = areaItem.name;
            clonedChef.__queryMeta = getChefMaterialSkillMeta(clonedChef);
            clonedChef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
                ? window.calculateMaterialExpectation(clonedChef, clonedChef.equip || null, clonedChef.disk || {})
                : 0;

            // 检查是否是光环厨师
            var auraInfo = checkAuraChef(clonedChef, skillType, chefPoolData.context);

            var metric = getAreaQueryMetric(areaItem, clonedChef);

            // 如果是光环厨师，添加光环信息到 detailText
            if (auraInfo.isAura && (auraInfo.auraType === skillType || auraInfo.auraType === '全技法')) {
                var auraMultiplier = auraInfo.auraScope === '场上所有厨师' ? areaItem.people : 1;
                var totalAuraBonus = auraInfo.auraBonus * auraMultiplier;
                metric.detailText += '（光环：' + auraInfo.auraType + '+' + auraInfo.auraBonus + ' X' + auraMultiplier + ' = ' + totalAuraBonus + '）';
            }

            // 用克隆后的数据更新原始厨师
            Object.assign(chef, clonedChef);

            // 计算总贡献值
            var totalContribution = metric.rawValue;
            if (auraInfo.isAura && (auraInfo.auraType === skillType || auraInfo.auraType === '全技法')) {
                // 光环厨师：基础技法值 + 光环加成 × 乘数
                var auraMultiplier = auraInfo.auraScope === '场上所有厨师' ? areaItem.people : 1;
                var auraContribution = auraInfo.auraBonus * auraMultiplier;
                totalContribution = metric.rawValue + auraContribution;

            }

            return $.extend({
                chef: chef,
                auraInfo: auraInfo,
                totalContribution: totalContribution
            }, metric);
        }).filter(function(item) {
            return item.rawValue > 0;
        }).sort(function(left, right) {
            // 按总贡献值排序（光环厨师会因为光环加成而排在前面）
            if (right.totalContribution !== left.totalContribution) {
                return right.totalContribution - left.totalContribution;
            }
            // 总贡献值相同时，按红色心法盘数量排序
            if (right.meta.redAmberCount !== left.meta.redAmberCount) {
                return right.meta.redAmberCount - left.meta.redAmberCount;
            }
            // 最后按稀有度排序
            return toInt(right.chef.rarity, 0) - toInt(left.chef.rarity, 0);
        });


        var selected = candidates.slice(0, areaItem.people).map(function(item) {
            var result = buildSelectedCollectionChef(item, areaItem);
            // 保存总贡献值（用于计算总技法值）
            result.totalContribution = item.totalContribution;
            result.auraInfo = item.auraInfo;
            return result;
        });

        var totalValue = selected.reduce(function(total, item) {
            return total + (item.totalContribution || item.rawValue);
        }, 0);

        return {
            selected: selected,
            totalValue: totalValue
        };
    }

    // 菜地区查询：
    // 按采集期望优先选人；若总采集点不足，尝试用低期望高采集值厨师兜底替换。
    function executeVegAreaQuery(areaItem, availableChefs, chefPoolData) {
        var allCandidates = sortVegCandidates(availableChefs.map(function(chef) {
            // 克隆厨师对象，避免影响其他区域的查询
            var clonedChef = cloneData(chef);
            
            // 恢复原始厨具信息（因为克隆后可能丢失）
            clonedChef.__originalEquip = chef.__originalEquip;
            clonedChef.__originalEquipId = chef.__originalEquipId;
            clonedChef.__originalEquipDisp = chef.__originalEquipDisp;

            // 应用银布鞋配置
            var equipChanged = applySilverShoesIfNeeded(clonedChef, chefPoolData.context, 'veg');
            // 统一重算，确保银布鞋与心法盘加成统计一致
            if (equipChanged) {
                // 重新计算厨师数据（包括修炼技能）
                recalculateChefData(clonedChef, chefPoolData);
            }
            // 无论是否替换厨具，都按当前地区重建元数据
            clonedChef.__queryAreaName = areaItem.name;
            clonedChef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
                ? window.calculateMaterialExpectation(clonedChef, clonedChef.equip || null, clonedChef.disk || {})
                : 0;
            // 重新计算材料技能元数据
            var meta = getChefMaterialSkillMeta(clonedChef);
            clonedChef.__queryMeta = meta;

            var metric = getAreaQueryMetric(areaItem, clonedChef);

            return $.extend({
                chef: clonedChef
            }, metric);
        }).filter(function(item) {
            return item.rawValue > 0 && !item.meta.hasRareGuestSkill && !item.meta.hasOpeningTimeSkill;
        }));
        var selected = allCandidates.slice(0, areaItem.people);
        var totalValue = selected.reduce(function(total, item) {
            return total + item.rawValue;
        }, 0);

        if (totalValue < areaItem.capacity && allCandidates.length > selected.length) {
            var protectedIds = selected.slice().sort(function(left, right) {
                return right.expectation - left.expectation;
            }).slice(0, 2).map(function(item) {
                return String(item.chef.chefId || item.chef.id || item.chef.name);
            });
            var remainingCandidates = allCandidates.filter(function(item) {
                var id = String(item.chef.chefId || item.chef.id || item.chef.name);
                return !selected.some(function(selectedItem) {
                    return String(selectedItem.chef.chefId || selectedItem.chef.id || selectedItem.chef.name) === id;
                });
            });

            selected.slice().sort(function(left, right) {
                return left.expectation - right.expectation;
            }).some(function(candidateChef) {
                var candidateChefId = String(candidateChef.chef.chefId || candidateChef.chef.id || candidateChef.chef.name);
                var currentValue = candidateChef.rawValue;
                var neededGap;
                var replacement;

                if (protectedIds.indexOf(candidateChefId) >= 0) {
                    return false;
                }

                neededGap = areaItem.capacity - (totalValue - currentValue);
                replacement = remainingCandidates.filter(function(item) {
                    return item.rawValue >= neededGap && getChefTopTwoCollectionSum(item.chef) <= 25;
                }).sort(function(left, right) {
                    if (right.expectation !== left.expectation) {
                        return right.expectation - left.expectation;
                    }
                    return right.rawValue - left.rawValue;
                })[0];

                if (!replacement) {
                    return false;
                }

                selected = selected.filter(function(item) {
                    return String(item.chef.chefId || item.chef.id || item.chef.name) !== candidateChefId;
                });
                selected.push(replacement);
                remainingCandidates = remainingCandidates.filter(function(item) {
                    return String(item.chef.chefId || item.chef.id || item.chef.name) !== String(replacement.chef.chefId || replacement.chef.id || replacement.chef.name);
                }).concat([candidateChef]);
                totalValue = selected.reduce(function(total, item) {
                    return total + item.rawValue;
                }, 0);
                return totalValue >= areaItem.capacity;
            });
        }

        return applyAreaTeamCollectionBonus(selected.map(function(item) {
            return buildSelectedCollectionChef(item, areaItem);
        }), areaItem, chefPoolData.context);
    }

    // 根据地区名确定结果卡片里的采集维度高亮。
    function getCollectionHighlightKeyByAreaName(areaName) {
        if (areaName.indexOf('牧场') >= 0 || areaName.indexOf('猪圈') >= 0 || areaName.indexOf('鸡舍') >= 0 || areaName.indexOf('永昼宫') >= 0) {
            return 'meat';
        }
        if (areaName.indexOf('池塘') >= 0 || areaName.indexOf('还寒洞') >= 0) {
            return 'fish';
        }
        if (areaName.indexOf('菜棚') >= 0 || areaName.indexOf('菜地') >= 0 || areaName.indexOf('森林') >= 0 || areaName.indexOf('清空谷') >= 0) {
            return 'veg';
        }
        if (areaName.indexOf('作坊') >= 0 || areaName.indexOf('北冥城') >= 0) {
            return 'creation';
        }
        return '';
    }

    // 参考 show 项目的地区配色，返回结果卡片标题中的地区名称颜色。
    function getCollectionAreaNameColor(areaName, prefix) {
        var name = String(areaName || '').replace(/技法$/, '');
        var colorMap = {
            jade: {
                '朝阴山': '#000000',
                '永昼宫': '#ff0000',
                '还寒洞': '#0000ff',
                '北冥城': '#ffa500',
                '藏心亭': '#ff69b4',
                '清空谷': '#00aa00'
            },
            veg: {
                '池塘': '#0000ff',
                '牧场': '#ff0000',
                '猪圈': '#ff0000',
                '鸡舍': '#ff0000',
                '菜棚': '#00aa00',
                '菜地': '#00aa00',
                '森林': '#00aa00',
                '作坊': '#ffa500'
            },
            lab: {
                '蒸': '#ffa500',
                '炸': '#2196f3',
                '炒': '#f44336',
                '煮': '#4caf50',
                '切': '#795548',
                '烤': '#9c27b0'
            },
            cond: {
                '樊正阁': '#e91e63',
                '庖丁阁': '#9c27b0',
                '膳祖阁': '#673ab7',
                '易牙阁': '#3f51b5',
                '彭铿阁': '#2196f3',
                '伊尹阁': '#009688'
            }
        };

        return colorMap[prefix] && colorMap[prefix][name] ? colorMap[prefix][name] : '';
    }

    // 生成结果卡片中的厨师行（含空位卡片与替换按钮）。
    function getCollectionResultChefHtml(item, areaName) {
        if (isEmptyCollectionChef(item)) {
            return [
                '<div class="collection-result-chef-card is-empty collection-result-chef-empty-trigger" data-area-name="', escapeHtml(areaName), '">',
                    '<div class="collection-result-chef-empty">空位（点击补位）</div>',
                '</div>'
            ].join('');
        }

        var rarityHtml = getCombinationStarsHtml(item.rarity);
        var metaHtml = [];
        var secondRowHtml = [];

        if (item.prefix === 'lab') {
            // 实验室：第二行显示技法值和红色心法盘
            var auraContribution = Math.max(0, toInt((item.totalContribution || item.rawValue), 0) - toInt(item.rawValue, 0));
            metaHtml.push('<span class="collection-result-chef-meta-item is-lab-value">' + escapeHtml(item.valueLabel) + ' <span class="collection-result-chef-value-number">' + item.rawValue + '</span></span>');
            metaHtml.push('<span class="collection-result-chef-meta-item is-red-amber">红色心法盘 ' + item.redAmberCount + '</span>');

            if (auraContribution > 0) {
                var auraText = '光环加成 +' + auraContribution;
                if (item.auraInfo && item.auraInfo.isAura) {
                    var auraMultiplier = item.auraInfo.auraBonus > 0 ? Math.round(auraContribution / item.auraInfo.auraBonus) : 1;
                    auraText = '光环 ' + item.auraInfo.auraType + '+' + item.auraInfo.auraBonus + ' ×' + auraMultiplier + ' = +' + auraContribution;
                }
                secondRowHtml.push('<span class="collection-result-chef-meta-item is-aura">' + escapeHtml(auraText) + '</span>');
            }
        } else if (item.prefix === 'veg') {
            // 菜地区域：第二行显示所有采集点和采集期望值
            var collectionItems = [
                { label: '肉', value: item.meatVal, key: 'meat' },
                { label: '鱼', value: item.fishVal, key: 'fish' },
                { label: '菜', value: item.vegVal, key: 'veg' },
                { label: '面', value: item.creationVal, key: 'creation' }
            ];
            
            // 判断当前地区对应的采集类型
            var currentKey = '';
            if (areaName.indexOf('牧场') >= 0 || areaName.indexOf('猪圈') >= 0 || areaName.indexOf('鸡舍') >= 0 || areaName.indexOf('永昼宫') >= 0) {
                currentKey = 'meat';
            } else if (areaName.indexOf('池塘') >= 0 || areaName.indexOf('还寒洞') >= 0) {
                currentKey = 'fish';
            } else if (areaName.indexOf('菜棚') >= 0 || areaName.indexOf('菜地') >= 0 || areaName.indexOf('森林') >= 0 || areaName.indexOf('清空谷') >= 0) {
                currentKey = 'veg';
            } else if (areaName.indexOf('作坊') >= 0 || areaName.indexOf('北冥城') >= 0) {
                currentKey = 'creation';
            }
            
            collectionItems.forEach(function(collItem) {
                var isHighlight = collItem.key === currentKey;
                var className = isHighlight ? 'collection-result-chef-meta-item is-collection-highlight' : 'collection-result-chef-meta-item is-collection-normal';
                metaHtml.push('<span class="' + className + '">' + collItem.label + ' ' + collItem.value + '</span>');
            });
            
            metaHtml.push('<span class="collection-result-chef-meta-item is-expectation">采集期望值 ' + item.collectionExpectation + '</span>');
            
            // 第三行：素材、暴击素材、暴击率
            secondRowHtml.push('<span class="collection-result-chef-meta-item is-material">素材 ' + item.materialGain + '%</span>');
            secondRowHtml.push('<span class="collection-result-chef-meta-item is-crit-material">暴击素材 ' + item.critMaterial + '%</span>');
            secondRowHtml.push('<span class="collection-result-chef-meta-item is-crit-chance">暴击率 ' + item.critChance + '%</span>');
        } else {
            // 玉片区：第二行显示采集点和采集期望值
            metaHtml.push('<span class="collection-result-chef-meta-item is-jade-value">' + escapeHtml(item.valueLabel) + ' <span class="collection-result-chef-value-number">' + item.rawValue + '</span></span>');
            metaHtml.push('<span class="collection-result-chef-meta-item is-expectation">采集期望值 ' + item.collectionExpectation + '</span>');
            
            // 第三行：素材、暴击素材、暴击率
            secondRowHtml.push('<span class="collection-result-chef-meta-item is-material">素材 ' + item.materialGain + '%</span>');
            secondRowHtml.push('<span class="collection-result-chef-meta-item is-crit-material">暴击素材 ' + item.critMaterial + '%</span>');
            secondRowHtml.push('<span class="collection-result-chef-meta-item is-crit-chance">暴击率 ' + item.critChance + '%</span>');
        }

        var metaRowsHtml = '<div class="collection-result-chef-meta">' + metaHtml.join('') + '</div>';
        if (secondRowHtml.length > 0) {
            metaRowsHtml += '<div class="collection-result-chef-meta">' + secondRowHtml.join('') + '</div>';
        }

        return [
            '<div class="collection-result-chef-card">',
                '<div class="collection-result-chef-head">',
                    '<div class="collection-result-chef-head-left">',
                        '<span class="collection-result-chef-name">', escapeHtml(item.name), '</span>',
                        rarityHtml ? '<span class="collection-result-chef-stars">' + rarityHtml + '</span>' : '',
                    '</div>',
                    '<div class="collection-result-chef-head-right">',
                        '<button class="collection-result-chef-replace-btn" data-area-name="' + escapeHtml(areaName) + '" data-chef-name="' + escapeHtml(item.name) + '">替换</button>',
                    '</div>',
                '</div>',
                metaRowsHtml,
            '</div>'
        ].join('');
    }

    // 生成单个区域结果卡片。
    function getCollectionResultCardHtml(result) {
        var summaryHtml = [];
        var chefsHtml = result.chefs.length ? result.chefs.map(function(item) {
            return getCollectionResultChefHtml(item, result.areaName);
        }).join('') : '<div class="collection-preview-empty">没有可用厨师</div>';
        var areaNameColor = getCollectionAreaNameColor(result.areaName, result.prefix);
        var areaNameStyle = areaNameColor ? (' style="color:' + areaNameColor + ';"') : '';
        var cardStyle = areaNameColor ? (' style="border-top-color:' + areaNameColor + ';"') : '';

        summaryHtml.push('<span class="collection-result-summary-pill">人数 ' + getAssignedChefCount(result.chefs) + '/' + result.people + '</span>');
        if (result.prefix === 'lab') {
            summaryHtml.push('<span class="collection-result-summary-pill">总技法 ' + result.totalValue + '</span>');
        } else {
            summaryHtml.push('<span class="collection-result-summary-pill">采集点 ' + result.totalValue + '/' + result.capacity + '</span>');
        }
        if (result.insufficient) {
            summaryHtml.push('<span class="collection-result-summary-pill is-warning">未达标</span>');
        }

        return [
            '<div class="collection-result-card collection-result-card-', escapeHtml(result.prefix), '" data-area-name="', escapeHtml(result.areaName), '"' + cardStyle + '>',
                '<div class="collection-result-card-head">',
                    '<div class="collection-result-card-title-wrap">',
                        '<div class="collection-result-card-title">',
                            '<span class="collection-result-area-name"' + areaNameStyle + '>' + escapeHtml(result.areaName) + '</span>',
                            '<span class="collection-result-title-summary">', summaryHtml.join(''), '</span>',
                        '</div>',
                    '</div>',
                    '<div class="collection-result-card-actions">',
                        '<button class="collection-result-save-btn" data-area-name="' + escapeHtml(result.areaName) + '" data-area-prefix="' + escapeHtml(result.prefix) + '">保存组合</button>',
                        '<button class="collection-result-toggle-btn" data-area-name="' + escapeHtml(result.areaName) + '">',
                            '<span class="glyphicon glyphicon-chevron-up"></span>',
                        '</button>',
                    '</div>',
                '</div>',
                '<div class="collection-result-chef-list">', chefsHtml, '</div>',
            '</div>'
        ].join('');
    }

    // 生成结果区域视图（分组pill + 区域卡片）。
    function getCollectionPreviewHtml() {
        var results = state.queryResults;
        var activeGroup;
        var groups;
        var pillsHtml;
        var cardsHtml;

        if (state.queryLoading) {
            return [
                '<div class="collection-preview-title">结果区域</div>',
                '<div class="collection-preview-loading">查询中...</div>'
            ].join('');
        }

        if (!results || !results.items.length) {
            return [
                '<div class="collection-preview-title">结果区域</div>',
                '<div class="collection-preview-empty">点击查询后在这里展示结果</div>'
            ].join('');
        }

        groups = results.groupOrder.filter(function(groupKey) {
            return results.items.some(function(item) {
                return item.groupKey === groupKey;
            });
        });
        activeGroup = groups.indexOf(state.activePreviewGroup) >= 0 ? state.activePreviewGroup : groups[0];

        pillsHtml = groups.map(function(groupKey) {
            var count = results.items.filter(function(item) {
                return item.groupKey === groupKey;
            }).length;
            return '<button type="button" class="collection-pill' + (groupKey === activeGroup ? ' is-active' : '') + '" data-action="switch-preview-group" data-group="' + escapeHtml(groupKey) + '">' + escapeHtml(AREA_GROUP_TITLES[groupKey]) + ' ' + count + '</button>';
        }).join('');

        cardsHtml = results.items.filter(function(item) {
            return item.groupKey === activeGroup;
        }).map(function(item) {
            return getCollectionResultCardHtml(item);
        }).join('');

        return [
            '<div class="collection-preview-title">结果区域</div>',
            '<div class="collection-preview-pills">', pillsHtml, '</div>',
            '<div class="collection-result-list">', cardsHtml, '</div>'
        ].join('');
    }

    // 执行全区域查询：按排序顺序逐区选人，并从候选池中移除已分配厨师。
    function executeCollectionQuery(areaItems, chefPoolData) {
        var availableChefs = chefPoolData.chefs.slice();
        var results = [];
        var groupOrder = [];

        areaItems.forEach(function(areaItem) {
            var candidates;
            var selected;
            var totalValue;
            var result;
            var vegQueryResult;

            if (areaItem.people <= 0) {
                return;
            }

            if (areaItem.prefix === 'cond') {
                result = {
                    areaName: areaItem.name,
                    groupKey: areaItem.prefix,
                    prefix: areaItem.prefix,
                    targetLabel: '调料',
                    people: areaItem.people,
                    capacity: areaItem.capacity,
                    totalValue: 0,
                    insufficient: true,
                    chefs: []
                };
                results.push(result);
                if (groupOrder.indexOf(result.groupKey) < 0) {
                    groupOrder.push(result.groupKey);
                }
                return;
            }

            if (areaItem.prefix === 'veg') {
                vegQueryResult = executeVegAreaQuery(areaItem, availableChefs, chefPoolData);
                selected = vegQueryResult.selected;
                totalValue = vegQueryResult.totalValue;

                selected.forEach(function(item) {
                    availableChefs = availableChefs.filter(function(chef) {
                        return String(chef.chefId || chef.id || chef.name) !== String(item.id);
                    });
                });

                result = {
                    areaName: areaItem.name,
                    groupKey: areaItem.prefix,
                    prefix: areaItem.prefix,
                    targetLabel: selected[0] ? selected[0].valueLabel : getAreaQueryMetric(areaItem, {}).label,
                    people: areaItem.people,
                    capacity: areaItem.capacity,
                    totalValue: totalValue,
                    insufficient: selected.length < areaItem.people || totalValue < areaItem.capacity,
                    chefs: selected
                };

                results.push(result);
                if (groupOrder.indexOf(result.groupKey) < 0) {
                    groupOrder.push(result.groupKey);
                }
                return;
            }

            if (areaItem.prefix === 'jade') {
                var jadeQueryResult = executeJadeAreaQuery(areaItem, availableChefs, chefPoolData);
                selected = jadeQueryResult.selected;
                totalValue = jadeQueryResult.totalValue;

                selected.forEach(function(item) {
                    availableChefs = availableChefs.filter(function(chef) {
                        return String(chef.chefId || chef.id || chef.name) !== String(item.id);
                    });
                });

                result = {
                    areaName: areaItem.name,
                    groupKey: areaItem.prefix,
                    prefix: areaItem.prefix,
                    targetLabel: selected[0] ? selected[0].valueLabel : getAreaQueryMetric(areaItem, {}).label,
                    people: areaItem.people,
                    capacity: areaItem.capacity,
                    totalValue: totalValue,
                    insufficient: selected.length < areaItem.people || totalValue < areaItem.capacity,
                    chefs: selected
                };

                results.push(result);
                if (groupOrder.indexOf(result.groupKey) < 0) {
                    groupOrder.push(result.groupKey);
                }
                return;
            }

            if (areaItem.prefix === 'lab') {
                var labQueryResult = executeLabAreaQuery(areaItem, availableChefs, chefPoolData);
                selected = labQueryResult.selected;
                totalValue = labQueryResult.totalValue;

                selected.forEach(function(item) {
                    availableChefs = availableChefs.filter(function(chef) {
                        return String(chef.chefId || chef.id || chef.name) !== String(item.id);
                    });
                });

                result = {
                    areaName: areaItem.name,
                    groupKey: areaItem.prefix,
                    prefix: areaItem.prefix,
                    targetLabel: selected[0] ? selected[0].valueLabel : getAreaQueryMetric(areaItem, {}).label,
                    people: areaItem.people,
                    capacity: areaItem.capacity,
                    totalValue: totalValue,
                    insufficient: selected.length < areaItem.people,
                    chefs: selected
                };

                results.push(result);
                if (groupOrder.indexOf(result.groupKey) < 0) {
                    groupOrder.push(result.groupKey);
                }
                return;
            }

            candidates = availableChefs.map(function(chef) {
                var metric = getAreaQueryMetric(areaItem, chef);
                return $.extend({
                    chef: chef
                }, metric);
            }).filter(function(item) {
                return item.rawValue > 0;
            }).sort(function(left, right) {
                if (right.score !== left.score) {
                    return right.score - left.score;
                }
                if (right.rawValue !== left.rawValue) {
                    return right.rawValue - left.rawValue;
                }
                return toInt(right.chef.rarity, 0) - toInt(left.chef.rarity, 0);
            });

            selected = candidates.slice(0, areaItem.people).map(function(item) {
                return buildSelectedCollectionChef(item, areaItem);
            });

            totalValue = selected.reduce(function(total, item) {
                return total + item.rawValue;
            }, 0);

            selected.forEach(function(item) {
                availableChefs = availableChefs.filter(function(chef) {
                    return String(chef.chefId || chef.id || chef.name) !== String(item.id);
                });
            });

            result = {
                areaName: areaItem.name,
                groupKey: areaItem.prefix,
                prefix: areaItem.prefix,
                targetLabel: selected[0] ? selected[0].valueLabel : getAreaQueryMetric(areaItem, {}).label,
                people: areaItem.people,
                capacity: areaItem.capacity,
                totalValue: totalValue,
                insufficient: areaItem.prefix === 'lab' ? selected.length < areaItem.people : (selected.length < areaItem.people || totalValue < areaItem.capacity),
                chefs: selected
            };

            results.push(result);
            if (groupOrder.indexOf(result.groupKey) < 0) {
                groupOrder.push(result.groupKey);
            }
        });

        return {
            generatedAt: Date.now(),
            groupOrder: groupOrder,
            items: results
        };
    }

    // 触发一次查询流程（异步执行，避免阻塞UI）。
    function startCollectionQuery() {
        state.queryLoading = true;
        render();

        window.setTimeout(function() {
            var chefPoolData = buildCollectionChefPool();
            var areaItems;

            if (chefPoolData.error) {
                state.queryLoading = false;
                state.queryResults = null;
                render();
                showPlaceholder('查询失败', chefPoolData.error);
                return;
            }

            areaItems = buildSortItems().items.filter(function(item) {
                return item.people > 0;
            });

            if (!areaItems.length) {
                state.queryLoading = false;
                state.queryResults = null;
                render();
                showPlaceholder('查询失败', '请先开启至少一个区域并设置人数');
                return;
            }

            if (!chefPoolData.chefs.length) {
                state.queryLoading = false;
                state.queryResults = null;
                render();
                showPlaceholder('查询失败', '当前没有可参与查询的厨师');
                return;
            }

            state.queryResults = executeCollectionQuery(areaItems, chefPoolData);
            state.queryLoading = false;
            if (state.queryResults.groupOrder.length) {
                state.activePreviewGroup = state.queryResults.groupOrder[0];
            }
            render();
        }, 0);
    }

    // 区域开关卡片HTML。
    function getAreaCard(title, tone, key, enabled, disabled) {
        var checked = enabled ? ' checked' : '';
        var disabledAttr = disabled ? ' disabled' : '';
        var disabledClass = disabled ? ' is-disabled' : '';
        return [
            '<div class="collection-area-card collection-tone-', tone, disabledClass, '">',
                '<div class="collection-area-name">', title, '</div>',
                '<label class="collection-switch" title="控制该区域是否参与查询">',
                    '<input type="checkbox" class="collection-area-toggle" data-area="', key, '"', checked, disabledAttr, '>',
                    '<span class="collection-switch-track"></span>',
                '</label>',
            '</div>'
        ].join('');
    }

    // 渲染采集编队主界面（设置区 + 结果区）。
    function render() {
        var $root = ensureRoot();
        var caretClass = state.settingsExpanded ? 'glyphicon-chevron-up' : 'glyphicon-chevron-down';
        var settingsBodyClass = state.settingsExpanded ? '' : ' hidden';

        var html = [
            '<div class="collection-shell">',
                '<div class="collection-settings-panel">',
                    '<div class="collection-panel-header">',
                        '<span class="collection-panel-title">查询设置</span>',
                        '<div class="collection-panel-actions">',
                            '<button type="button" class="btn btn-sm btn-default collection-config-btn" data-action="open-config" title="配置区域">',
                                '<span class="glyphicon glyphicon-cog"></span> 配置',
                            '</button>',
                            '<button type="button" class="btn btn-sm btn-default collection-panel-toggle" data-action="toggle-settings" title="收起/展开">',
                                '<span class="glyphicon ', caretClass, '"></span>',
                            '</button>',
                        '</div>',
                    '</div>',
                    '<div class="collection-settings-body', settingsBodyClass, '">',
                        '<div class="collection-area-grid">',
                            getAreaCard('菜地区', 'veg', 'veg', state.areaEnabled.veg, false),
                            getAreaCard('玉片区', 'jade', 'jade', state.areaEnabled.jade, false),
                            getAreaCard('实验室', 'lab', 'lab', state.areaEnabled.lab, false),
                        '</div>',
                        '<div class="collection-action-grid">',
                            '<button type="button" class="btn btn-primary collection-action-btn" data-action="sort-priority">',
                                '排序',
                            '</button>',
                            '<button type="button" class="btn btn-primary collection-action-btn" data-action="view-teams">',
                                '查看编队',
                            '</button>',
                            '<button type="button" class="btn btn-primary collection-action-btn collection-query-btn" data-action="query">',
                                '查询',
                            '</button>',
                        '</div>',
                    '</div>',
                '</div>',
                '<div class="collection-preview-panel">',
                    getCollectionPreviewHtml(),
                '</div>',
            '</div>'
        ].join('');

        $root.html(html).removeClass('hidden');
    }

    // 统一错误提示出口。
    function showPlaceholder(title, message) {
        if (typeof window.showAlert === 'function') {
            window.showAlert(message, title);
        } else {
            window.alert(message);
        }
    }

    // 进入采集编队模式并初始化页面。
    function load() {
        if (!hasCollectionRuleReady()) {
            bootstrapCollectionRule();
            return;
        }

        ensureRoot();
        loadStoredState();
        state.settingsExpanded = true;
        scheduleSortCacheRefresh();

        $('.cal-menu').removeClass('hidden');

        $('#pane-cal-custom')
            .css('visibility', 'visible')
            .removeClass('guest-rate-mode cultivate-mode banquet')
            .addClass('collection-team-mode');

        $('#pane-cal-custom .cal-custom-item').hide();
        $('#guest-rate-result').addClass('hidden');
        $('#pengci-query-area').addClass('hidden');
        $('#guest-query-mode-switch-wrapper').addClass('hidden');
        $('#pengci-mainline-wrapper').addClass('hidden');
        $('#banquet-auto-calc').addClass('hidden');
        $('#competition-auto-calc').addClass('hidden');
        $('#banquet-progress-wrapper').addClass('hidden');
        $('#competition-progress-wrapper').addClass('hidden');

        render();
        activateRulesPane();

        $('#btn-cal-rule-load').prop('disabled', false).removeClass('btn-danger');
        $('.loading').addClass('hidden');
    }

    $(document).on('click', '#collection-team-root [data-action="toggle-settings"]', function() {
        state.settingsExpanded = !state.settingsExpanded;
        render();
    });

    $(document).on('change', '#collection-team-root .collection-area-toggle', function() {
        var savedAreaNames;
        var enabledItems;
        var area = $(this).data('area');
        state.areaEnabled[area] = $(this).prop('checked');
        saveBooleanSetting(area + '_enabled', state.areaEnabled[area]);
        savedAreaNames = getSavedAreaNames();
        enabledItems = getEnabledAreaItems(savedAreaNames);
        syncUnifiedAreaOrder(savedAreaNames, enabledItems);
        scheduleSortCacheRefresh();
        render();
    });

    $(document).on('click', '#collection-team-root [data-action="sort-priority"]', function() {
        showSortDialog();
    });

    $(document).on('click', '#collection-team-root [data-action="view-teams"]', function() {
        showSavedCombinationsDialog();
    });

    $(document).on('click', '#collection-team-root [data-action="switch-preview-group"]', function() {
        state.activePreviewGroup = $(this).data('group');
        render();
    });

    $(document).on('click', '.collection-result-chef-replace-btn', function(e) {
        e.stopPropagation();
        var areaName = $(this).data('area-name');
        var chefName = $(this).data('chef-name');
        showReplaceChefDialog(areaName, chefName);
    });

    $(document).on('click', '.collection-result-chef-empty-trigger', function(e) {
        e.stopPropagation();
        var areaName = $(this).data('area-name');
        showReplaceChefDialog(areaName, '');
    });

    $(document).on('click', '.collection-result-save-btn', function(e) {
        e.stopPropagation();
        var areaName = $(this).data('area-name');
        var areaPrefix = $(this).data('area-prefix');
        saveAreaCombination(areaName, areaPrefix);
    });

    $(document).on('click', '.collection-result-toggle-btn', function(e) {
        e.stopPropagation();
        var $card = $(this).closest('.collection-result-card');
        var $chefList = $card.find('.collection-result-chef-list');
        var $icon = $(this).find('.glyphicon');
        
        if ($card.hasClass('is-collapsed')) {
            $card.removeClass('is-collapsed');
            $chefList.slideDown(200);
            $icon.removeClass('glyphicon-chevron-down').addClass('glyphicon-chevron-up');
        } else {
            $card.addClass('is-collapsed');
            $chefList.slideUp(200);
            $icon.removeClass('glyphicon-chevron-up').addClass('glyphicon-chevron-down');
        }
    });

    // 保存单个区域组合并从当前结果中移除该区域。
    function saveAreaCombination(areaName, areaPrefix) {
        if (!state.queryResults || !state.queryResults.items) {
            alert('请先执行查询');
            return;
        }

        // 查找当前区域的结果
        var areaResult = state.queryResults.items.find(function(result) {
            return result.areaName === areaName;
        });

        if (!areaResult) {
            alert('未找到区域结果');
            return;
        }

        if (!areaResult.chefs || areaResult.chefs.length === 0) {
            alert('该区域没有厨师，无法保存');
            return;
        }

        // 构建保存的组合数据
        var savedChefs = areaResult.chefs.map(function(chef) {
            return {
                name: chef.name,
                rarity: chef.rarity,
                isUltimate: chef.isUltimate
            };
        });

        var combination = {
            areaName: areaName,
            savedTime: Date.now(),
            chefs: savedChefs
        };

        // 加载现有的组合
        var bundle = loadSavedCombinationBundle();
        var rawList = bundle.rawList;

        // 检查是否已经保存过该区域
        var existingIndex = -1;
        for (var i = 0; i < rawList.length; i++) {
            if (rawList[i].areaName === areaName) {
                existingIndex = i;
                break;
            }
        }

        if (existingIndex >= 0) {
            // 更新现有组合
            bootbox.confirm({
                message: '该区域已有保存的组合，是否覆盖？',
                buttons: {
                    confirm: { label: '覆盖', className: 'btn-primary' },
                    cancel: { label: '取消', className: 'btn-default' }
                },
                callback: function(result) {
                    if (result) {
                        rawList[existingIndex] = combination;
                        saveSavedCombinationRawList(rawList);

                        // 从查询结果中移除该区域
                        state.queryResults.items = state.queryResults.items.filter(function(result) {
                            return result.areaName !== areaName;
                        });

                        render();
                        scheduleSortCacheRefresh();
                    }
                }
            });
        } else {
            // 添加新组合
            rawList.push(combination);
            saveSavedCombinationRawList(rawList);

            // 从查询结果中移除该区域
            state.queryResults.items = state.queryResults.items.filter(function(result) {
                return result.areaName !== areaName;
            });

            render();
            scheduleSortCacheRefresh();
        }
    }

    // 打开替换/补位弹窗并构建候选列表。
    // 会标记“已分配给某地区”的厨师，便于跨区替换决策。
    function showReplaceChefDialog(areaName, currentChefName) {
        // 查找当前区域的完整信息
        if (!state.queryResults || !state.queryResults.items) {
            alert('请先执行查询');
            return;
        }

        var currentArea = state.queryResults.items.find(function(result) {
            return result.areaName === areaName;
        });

        if (!currentArea) {
            alert('未找到区域信息');
            return;
        }

        var assignedMap = {};
        state.queryResults.items.forEach(function(result) {
            (result.chefs || []).forEach(function(chef) {
                if (isEmptyCollectionChef(chef)) {
                    return;
                }
                assignedMap[String(chef.name || '')] = result.areaName;
            });
        });

        // 获取可用厨师池
        var chefPoolData = buildCollectionChefPool();
        if (chefPoolData.error) {
            alert(chefPoolData.error);
            return;
        }
        var availableChefs = chefPoolData.chefs;

        // 过滤掉当前区域已选择的厨师
        var currentAreaChefNames = currentArea.chefs.filter(function(chef) {
            return !isEmptyCollectionChef(chef);
        }).map(function(chef) {
            return chef.name;
        });

        var candidateChefs = availableChefs.filter(function(chef) {
            return currentAreaChefNames.indexOf(chef.name) === -1;
        });

        // 根据区域类型计算候选厨师的技法值
        var areaItem = {
            name: currentArea.areaName,
            prefix: currentArea.prefix,
            people: currentArea.people,
            capacity: currentArea.capacity
        };

        var candidates = candidateChefs.map(function(chef) {
            var clonedChef = cloneData(chef);

            // 应用厨具配置
            if (areaItem.prefix === 'lab') {
                applyLabEquipIfNeeded(clonedChef, chefPoolData.context, areaItem.name);
            } else if (areaItem.prefix === 'jade') {
                applySilverShoesIfNeeded(clonedChef, chefPoolData.context, 'jade');
            } else if (areaItem.prefix === 'veg') {
                applySilverShoesIfNeeded(clonedChef, chefPoolData.context, 'veg');
            }

            recalculateChefData(clonedChef, chefPoolData);
            clonedChef.__queryAreaName = areaItem.name;
            clonedChef.__queryMeta = getChefMaterialSkillMeta(clonedChef);
            clonedChef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
                ? window.calculateMaterialExpectation(clonedChef, clonedChef.equip || null, clonedChef.disk || {})
                : 0;

            var metric = getAreaQueryMetric(areaItem, clonedChef);
            var assignedArea = assignedMap[String(clonedChef.name || '')] || '';

            // 如果是实验室区域，检查光环
            if (areaItem.prefix === 'lab') {
                var auraInfo = checkAuraChef(clonedChef, areaItem.name, chefPoolData.context);
                var totalContribution = metric.rawValue;

                if (auraInfo.isAura && (auraInfo.auraType === areaItem.name || auraInfo.auraType === '全技法')) {
                    var auraMultiplier = auraInfo.auraScope === '场上所有厨师' ? areaItem.people : 1;
                    var totalAuraBonus = auraInfo.auraBonus * auraMultiplier;
                    totalContribution = metric.rawValue + totalAuraBonus;
                    metric.detailText += '（光环：' + auraInfo.auraType + '+' + auraInfo.auraBonus + ' X' + auraMultiplier + ' = ' + totalAuraBonus + '）';
                }

                return {
                    chef: clonedChef,
                    metric: metric,
                    totalContribution: totalContribution,
                    auraInfo: auraInfo,
                    assignedArea: assignedArea,
                    isAssignedOtherArea: assignedArea && assignedArea !== currentArea.areaName
                };
            }

            return {
                chef: clonedChef,
                metric: metric,
                assignedArea: assignedArea,
                isAssignedOtherArea: assignedArea && assignedArea !== currentArea.areaName
            };
        }).filter(function(item) {
            return item.metric.rawValue > 0;
        }).sort(function(left, right) {
            if (areaItem.prefix === 'lab') {
                return (right.totalContribution || right.metric.rawValue) - (left.totalContribution || left.metric.rawValue);
            }
            return right.metric.score - left.metric.score;
        });

        // 显示替换对话框
        showReplaceChefDialogUI(currentArea, currentChefName, candidates.slice(0, 20));
    }

    // 渲染替换弹窗UI。
    // 菜地区会展示四维采集点和素材三指标（素材/暴击素材/暴击率）。
    function showReplaceChefDialogUI(currentArea, currentChefName, candidates) {
        var highlightKey = getCollectionHighlightKeyByAreaName(currentArea.areaName);
        var dialogHtml = [
            '<div class="replace-chef-dialog">',
                '<div class="replace-chef-dialog-header">',
                    '<h3>' + (currentChefName ? '替换厨师 - ' : '补位厨师 - ') + escapeHtml(currentArea.areaName) + '</h3>',
                    currentChefName ? '<div class="replace-chef-current">当前: ' + escapeHtml(currentChefName) + '</div>' : '<div class="replace-chef-current">当前: 空位</div>',
                '</div>',
                '<div class="replace-chef-dialog-body">',
                    candidates.length ? candidates.map(function(item) {
                        var chef = item.chef;
                        var metric = item.metric;
                        var rarityStars = '';
                        var assignedAreaTag = '';
                        var metricHtml = '';
                        var detailHtml = '';
                        for (var i = 0; i < toInt(chef.rarity, 0); i++) {
                            rarityStars += '★';
                        }

                        if (item.assignedArea) {
                            assignedAreaTag = '<span class="replace-chef-item-assigned">已分配给：' + escapeHtml(item.assignedArea) + '</span>';
                        }

                        if (currentArea.prefix === 'veg') {
                            var collectionItems = [
                                { label: '肉', value: toInt(chef.meatVal, 0), key: 'meat' },
                                { label: '鱼', value: toInt(chef.fishVal, 0), key: 'fish' },
                                { label: '菜', value: toInt(chef.vegVal, 0), key: 'veg' },
                                { label: '面', value: toInt(chef.creationVal, 0), key: 'creation' }
                            ];
                            metricHtml = '<div class="replace-chef-item-values">' + collectionItems.map(function(collItem) {
                                var className = collItem.key === highlightKey ? 'replace-chef-item-value-chip is-highlight' : 'replace-chef-item-value-chip';
                                return '<span class="' + className + '">' + collItem.label + ' ' + collItem.value + '</span>';
                            }).join('') + '</div>';
                            detailHtml = '<div class="replace-chef-item-skill-metrics">'
                                + '<span class="replace-chef-item-skill-chip is-material">素材 ' + (chef.__queryMeta && chef.__queryMeta.materialGain || 0) + '%</span>'
                                + '<span class="replace-chef-item-skill-chip is-crit-material">暴击素材 ' + (chef.__queryMeta && chef.__queryMeta.critMaterial || 0) + '%</span>'
                                + '<span class="replace-chef-item-skill-chip is-crit-chance">暴击率 ' + (chef.__queryMeta && chef.__queryMeta.critChance || 0) + '%</span>'
                                + '</div>';
                        } else {
                            metricHtml = '<div class="replace-chef-item-value">' + escapeHtml(metric.label) + ': <span class="replace-chef-item-value-number">' + metric.rawValue + '</span></div>';
                            detailHtml = '<div class="replace-chef-item-skill-metrics">'
                                + '<span class="replace-chef-item-skill-chip is-material">素材 ' + (chef.__queryMeta && chef.__queryMeta.materialGain || 0) + '%</span>'
                                + '<span class="replace-chef-item-skill-chip is-crit-material">暴击素材 ' + (chef.__queryMeta && chef.__queryMeta.critMaterial || 0) + '%</span>'
                                + '<span class="replace-chef-item-skill-chip is-crit-chance">暴击率 ' + (chef.__queryMeta && chef.__queryMeta.critChance || 0) + '%</span>'
                                + '</div>';
                        }

                        return [
                            '<div class="replace-chef-item' + (item.isAssignedOtherArea ? ' is-assigned-other-area' : '') + '" data-chef-name="' + escapeHtml(chef.name) + '">',
                                '<div class="replace-chef-item-info">',
                                    '<span class="replace-chef-item-name">' + escapeHtml(chef.name) + '</span>',
                                    rarityStars ? '<span class="replace-chef-item-stars">' + rarityStars + '</span>' : '',
                                    assignedAreaTag,
                                '</div>',
                                metricHtml,
                                detailHtml,
                            '</div>'
                        ].join('');
                    }).join('') : '<div class="replace-chef-empty">没有可用的替换厨师</div>',
                '</div>',
            '</div>'
        ].join('');

        var dialog = bootbox.dialog({
            message: dialogHtml,
            className: 'replace-chef-modal',
            closeButton: true,
            backdrop: true,
            onEscape: true
        });

        // 点击厨师项进行替换
        dialog.on('click', '.replace-chef-item', function() {
            var selectedChefName = $(this).data('chef-name');
            replaceChef(currentArea, currentChefName, selectedChefName);
            dialog.modal('hide');
        });
    }

    // 执行替换逻辑：
    // 1) 在当前区域替换或补位
    // 2) 若新厨师已在其他区域，则将原区域置为空位（跨区唯一分配）
    // 3) 重算当前区域与源区域总值/达标状态
    function replaceChef(currentArea, oldChefName, newChefName) {
        // 在查询结果中找到并替换厨师
        var areaResult = state.queryResults.items.find(function(result) {
            return result.prefix === currentArea.prefix && result.areaName === currentArea.areaName;
        });

        if (!areaResult) {
            alert('未找到区域结果');
            return;
        }

        // 找到要替换的厨师索引（空字符串表示补位）
        var chefIndex = -1;
        if (oldChefName) {
            chefIndex = areaResult.chefs.findIndex(function(chef) {
                return !isEmptyCollectionChef(chef) && chef.name === oldChefName;
            });
            if (chefIndex === -1) {
                alert('未找到要替换的厨师');
                return;
            }
        } else {
            chefIndex = areaResult.chefs.findIndex(function(chef) {
                return isEmptyCollectionChef(chef);
            });
            if (chefIndex === -1) {
                alert('当前区域没有可补位的空位');
                return;
            }
        }

        // 重新计算新厨师的数据
        var chefPoolData = buildCollectionChefPool();
        if (chefPoolData.error) {
            alert(chefPoolData.error);
            return;
        }
        var newChef = chefPoolData.chefs.find(function(chef) {
            return chef.name === newChefName;
        });

        if (!newChef) {
            alert('未找到新厨师');
            return;
        }

        var clonedChef = cloneData(newChef);
        var areaItem = {
            name: currentArea.areaName,
            prefix: currentArea.prefix,
            people: currentArea.people,
            capacity: currentArea.capacity
        };

        // 应用厨具配置
        if (areaItem.prefix === 'lab') {
            applyLabEquipIfNeeded(clonedChef, chefPoolData.context, areaItem.name);
        } else if (areaItem.prefix === 'jade') {
            applySilverShoesIfNeeded(clonedChef, chefPoolData.context, 'jade');
        } else if (areaItem.prefix === 'veg') {
            applySilverShoesIfNeeded(clonedChef, chefPoolData.context, 'veg');
        }

        recalculateChefData(clonedChef, chefPoolData);
        clonedChef.__queryAreaName = areaItem.name;
        clonedChef.__queryMeta = getChefMaterialSkillMeta(clonedChef);
        clonedChef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
            ? window.calculateMaterialExpectation(clonedChef, clonedChef.equip || null, clonedChef.disk || {})
            : 0;

        var metric = getAreaQueryMetric(areaItem, clonedChef);

        // 如果是实验室区域，检查光环
        if (areaItem.prefix === 'lab') {
            var auraInfo = checkAuraChef(clonedChef, areaItem.name, chefPoolData.context);

            if (auraInfo.isAura && (auraInfo.auraType === areaItem.name || auraInfo.auraType === '全技法')) {
                var auraMultiplier = auraInfo.auraScope === '场上所有厨师' ? areaItem.people : 1;
                var totalAuraBonus = auraInfo.auraBonus * auraMultiplier;
                metric.detailText += '（光环：' + auraInfo.auraType + '+' + auraInfo.auraBonus + ' X' + auraMultiplier + ' = ' + totalAuraBonus + '）';
            }
        }

        var newChefResult = buildSelectedCollectionChef({
            chef: clonedChef,
            rawValue: metric.rawValue,
            label: metric.label,
            detailText: metric.detailText,
            expectation: metric.expectation,
            meta: metric.meta
        }, areaItem);

        var sourceAreaResult = null;
        var sourceChefIndex = -1;

        state.queryResults.items.forEach(function(result) {
            var idx;
            if (sourceAreaResult || !result || result.areaName === currentArea.areaName) {
                return;
            }
            idx = (result.chefs || []).findIndex(function(chef) {
                return !isEmptyCollectionChef(chef) && chef.name === newChefName;
            });
            if (idx >= 0) {
                sourceAreaResult = result;
                sourceChefIndex = idx;
            }
        });

        // 替换当前区域厨师
        areaResult.chefs[chefIndex] = newChefResult;

        // 如果新厨师来自其他地区，清空原地区的该厨师位置
        if (sourceAreaResult && sourceChefIndex >= 0) {
            sourceAreaResult.chefs[sourceChefIndex] = createEmptyCollectionChef(sourceAreaResult.prefix);
        }

        // 重新计算总值
        if (areaItem.prefix === 'lab') {
            // 实验室需要重新计算光环加成
            var totalValue = 0;
            areaResult.chefs.forEach(function(chef) {
                var chefData;
                var clonedLabChef;
                var auraInfo;
                var contribution;

                if (isEmptyCollectionChef(chef)) {
                    return;
                }

                chefData = chefPoolData.chefs.find(function(c) {
                    return c.name === chef.name;
                });
                if (!chefData) {
                    return;
                }

                clonedLabChef = cloneData(chefData);
                applyLabEquipIfNeeded(clonedLabChef, chefPoolData.context, areaItem.name);
                recalculateChefData(clonedLabChef, chefPoolData);
                clonedLabChef.__queryAreaName = areaItem.name;
                clonedLabChef.__queryMeta = getChefMaterialSkillMeta(clonedLabChef);
                clonedLabChef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
                    ? window.calculateMaterialExpectation(clonedLabChef, clonedLabChef.equip || null, clonedLabChef.disk || {})
                    : 0;

                auraInfo = checkAuraChef(clonedLabChef, areaItem.name, chefPoolData.context);
                contribution = chef.rawValue;

                if (auraInfo.isAura && (auraInfo.auraType === areaItem.name || auraInfo.auraType === '全技法')) {
                    var auraMultiplier = auraInfo.auraScope === '场上所有厨师' ? areaItem.people : 1;
                    contribution += auraInfo.auraBonus * auraMultiplier;
                }

                totalValue += contribution;
            });
            areaResult.totalValue = totalValue;
        } else if (areaItem.prefix === 'veg' || areaItem.prefix === 'jade') {
            areaResult.totalValue = applyAreaTeamCollectionBonus(areaResult.chefs, areaItem, chefPoolData.context).totalValue;
        } else {
            areaResult.totalValue = areaResult.chefs.reduce(function(total, chef) {
                return total + (isEmptyCollectionChef(chef) ? 0 : chef.rawValue);
            }, 0);
        }

        if (sourceAreaResult) {
            if (sourceAreaResult.prefix === 'lab') {
                var sourceLabTotal = 0;
                sourceAreaResult.chefs.forEach(function(chef) {
                    var chefData;
                    var clonedSourceChef;
                    var sourceAuraInfo;
                    var sourceContribution;

                    if (isEmptyCollectionChef(chef)) {
                        return;
                    }

                    chefData = chefPoolData.chefs.find(function(c) {
                        return c.name === chef.name;
                    });
                    if (!chefData) {
                        return;
                    }

                    clonedSourceChef = cloneData(chefData);
                    applyLabEquipIfNeeded(clonedSourceChef, chefPoolData.context, sourceAreaResult.areaName);
                    recalculateChefData(clonedSourceChef, chefPoolData);
                    clonedSourceChef.__queryAreaName = sourceAreaResult.areaName;
                    clonedSourceChef.__queryMeta = getChefMaterialSkillMeta(clonedSourceChef);
                    clonedSourceChef.materialExpectation = typeof window.calculateMaterialExpectation === 'function'
                        ? window.calculateMaterialExpectation(clonedSourceChef, clonedSourceChef.equip || null, clonedSourceChef.disk || {})
                        : 0;

                    sourceAuraInfo = checkAuraChef(clonedSourceChef, sourceAreaResult.areaName, chefPoolData.context);
                    sourceContribution = chef.rawValue;
                    if (sourceAuraInfo.isAura && (sourceAuraInfo.auraType === sourceAreaResult.areaName || sourceAuraInfo.auraType === '全技法')) {
                        var sourceAuraMultiplier = sourceAuraInfo.auraScope === '场上所有厨师' ? sourceAreaResult.people : 1;
                        sourceContribution += sourceAuraInfo.auraBonus * sourceAuraMultiplier;
                    }

                    sourceLabTotal += sourceContribution;
                });
                sourceAreaResult.totalValue = sourceLabTotal;
            } else if (sourceAreaResult.prefix === 'veg' || sourceAreaResult.prefix === 'jade') {
                sourceAreaResult.totalValue = applyAreaTeamCollectionBonus(sourceAreaResult.chefs, {
                    name: sourceAreaResult.areaName,
                    prefix: sourceAreaResult.prefix,
                    people: sourceAreaResult.people,
                    capacity: sourceAreaResult.capacity
                }, chefPoolData.context).totalValue;
            } else {
                sourceAreaResult.totalValue = sourceAreaResult.chefs.reduce(function(total, chef) {
                    return total + (isEmptyCollectionChef(chef) ? 0 : chef.rawValue);
                }, 0);
            }
            sourceAreaResult.insufficient = getAssignedChefCount(sourceAreaResult.chefs) < sourceAreaResult.people || (sourceAreaResult.prefix !== 'lab' && sourceAreaResult.totalValue < sourceAreaResult.capacity);
        }

        areaResult.insufficient = getAssignedChefCount(areaResult.chefs) < areaResult.people || (areaItem.prefix !== 'lab' && areaResult.totalValue < areaItem.capacity);

        // 重新渲染
        render();
    }

    // =============================
    // 事件绑定区
    // 说明：这里统一绑定采集编队模式下的交互事件。
    // =============================
    $(document).on('click', '#collection-team-root [data-action="query"]', function() {
        startCollectionQuery();
    });

    $(document).on('click', '#collection-team-root [data-action="open-config"]', function(e) {
        e.stopPropagation(); // 阻止事件冒泡，避免触发折叠
        showAreaConfigDialog();
    });

    // 打开区域配置弹窗（菜地/玉片/实验室）。
    function showAreaConfigDialog() {
        var html = [
            '<div class="modal fade" id="area-config-modal" tabindex="-1">',
                '<div class="modal-dialog modal-lg">',
                    '<div class="modal-content">',
                        '<div class="modal-header">',
                            '<button type="button" class="close" data-dismiss="modal">&times;</button>',
                            '<h4 class="modal-title">区域配置</h4>',
                        '</div>',
                        '<div class="modal-body">',
                            '<ul class="nav nav-tabs" role="tablist">',
                                '<li class="active"><a href="#config-veg" data-toggle="tab">菜地区</a></li>',
                                '<li><a href="#config-jade" data-toggle="tab">玉片区</a></li>',
                                '<li><a href="#config-lab" data-toggle="tab">实验室</a></li>',
                            '</ul>',
                            '<div class="tab-content" style="margin-top: 15px;">',
                                '<div class="tab-pane active" id="config-veg">',
                                    getVegConfigPanel(),
                                '</div>',
                                '<div class="tab-pane" id="config-jade">',
                                    getJadeConfigPanel(),
                                '</div>',
                                '<div class="tab-pane" id="config-lab">',
                                    getLabConfigPanel(),
                                '</div>',
                            '</div>',
                        '</div>',
                        '<div class="modal-footer">',
                            '<button type="button" class="btn btn-default" data-dismiss="modal">关闭</button>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');

        var $modal = $(html);
        $modal.modal('show');
        $modal.on('hidden.bs.modal', function() {
            $modal.remove();
        });

        // 处理配置项的变化
        $modal.on('change', '.config-checkbox', function() {
            var $checkbox = $(this);
            var key = $checkbox.data('key');
            var checked = $checkbox.prop('checked');
            saveBooleanSetting(key, checked);

            // 实验室150和100厨具互斥
            if (key === 'useLabEquip150' && checked) {
                $modal.find('.config-lab-100').prop('checked', false);
                saveBooleanSetting('useBeginnerEquip100', false);
            } else if (key === 'useBeginnerEquip100' && checked) {
                $modal.find('.config-lab-150').prop('checked', false);
                saveBooleanSetting('useLabEquip150', false);
            }
        });
    }

    // 菜地区配置面板。
    function getVegConfigPanel() {
        var useSilverShoes = loadBooleanSetting('useSilverShoes', false);

        return [
            '<div class="config-panel">',
                '<div class="config-item">',
                    '<div class="config-item-header">',
                        '<label class="config-label">',
                            '<input type="checkbox" class="config-checkbox" data-key="useSilverShoes"', useSilverShoes ? ' checked' : '', '>',
                            '<span class="config-title">是否默认使用银布鞋</span>',
                        '</label>',
                    '</div>',
                    '<div class="config-item-desc">开启后，厨师厨具效率低于银布鞋的都会替换为银布鞋查询</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // 玉片区配置面板。
    function getJadeConfigPanel() {
        var useJadeSilverShoes = loadBooleanSetting('useJadeSilverShoes', false);

        return [
            '<div class="config-panel">',
                '<div class="config-item">',
                    '<div class="config-item-header">',
                        '<label class="config-label">',
                            '<input type="checkbox" class="config-checkbox" data-key="useJadeSilverShoes"', useJadeSilverShoes ? ' checked' : '', '>',
                            '<span class="config-title">是否默认使用银布鞋</span>',
                        '</label>',
                    '</div>',
                    '<div class="config-item-desc">开启后，厨师厨具效率低于银布鞋的都会替换为银布鞋查询</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // 实验室配置面板。
    function getLabConfigPanel() {
        var useLabEquip150 = loadBooleanSetting('useLabEquip150', false);
        var useBeginnerEquip100 = loadBooleanSetting('useBeginnerEquip100', false);

        return [
            '<div class="config-panel">',
                '<div class="config-item">',
                    '<div class="config-item-header">',
                        '<label class="config-label">',
                            '<input type="checkbox" class="config-checkbox config-lab-150" data-key="useLabEquip150"', useLabEquip150 ? ' checked' : '', '>',
                            '<span class="config-title">默认使用实验室150厨具</span>',
                        '</label>',
                    '</div>',
                    '<div class="config-item-desc">开启后，默认使用150技法厨具</div>',
                '</div>',
                '<div class="config-item">',
                    '<div class="config-item-header">',
                        '<label class="config-label">',
                            '<input type="checkbox" class="config-checkbox config-lab-100" data-key="useBeginnerEquip100"', useBeginnerEquip100 ? ' checked' : '', '>',
                            '<span class="config-title">默认使用新手100厨具</span>',
                        '</label>',
                    '</div>',
                    '<div class="config-item-desc">开启后，默认使用100技法厨具</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // 对外暴露入口。
    window.CollectionTeamQuery = {
        load: load
    };

    // 劫持原 loadCalRule：当选择采集编队模式时走本模块入口。
    $(function() {
        var originalLoadCalRule = window.loadCalRule;
        if (typeof originalLoadCalRule !== 'function') {
            return;
        }

        window.loadCalRule = function() {
            if ($('#select-cal-rule').val() === MODE_VALUE) {
                load();
                return;
            }
            resetMode();
            return originalLoadCalRule.apply(this, arguments);
        };
    });
})(window, window.jQuery);
