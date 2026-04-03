/**
 * 厨神大赛默认简化版优化器（紧凑重构版）
 * 仅保留默认模式实际使用的核心搜索链路。
 */

var DefaultCompetitionOptimizer = (function() {
    'use strict';

    var _isRunning = false;
    var _targetScore = null;
    var _bestResult = null;
    var _gameData = null;
    var _rule = null;
    var _bestScore = 0;
    var _simpleMode = true;

    var CONFIG = {
        recipeSeedK: 3,
        chefPerSeed: 2,
        recipeTopN: 8,
        maxRounds: 2,
        refineIter: 1,
        preFilterTop: 28,
        materialConflictWeight: 0.3,
        diversityBonus: 0.15
    };

    var _simState = null;
    var _bestSimState = null;
    var _topCandidates = [];
    var Top10Manager = {
        maxSize: 0,
        clear: function() {},
        getList: function() { return []; },
        getCombo: function() { return null; },
        _generateSignature: function() { return ''; },
        _findIndexBySignature: function() { return -1; },
        tryInsert: function() { return false; }
    };
    var _bestSeedSource = '';
    var _cachedConfig = {};
    var _chefMap = {};
    var _recipeMap = {};
    var _menus = [];
    var _materialsAll = null;
    var _availableEquips = [];
    var _onProgress = null;
    var _progressDisplayScore = 0;
    var _progressTarget = 0;
    var _progressTimer = null;
    var _progressFeasibleBest = 0;
    var _progressFeasibleState = null;
    var _newbieEquipEnabled = false;
    var _newbiePoolEquips = [];
    var _autoEquipAmber = false;
    var _autoEquip = false;
    var _autoAmber = false;
    var _autoCondiment = false;
    var _singleTrio = false;
    var _calcScoreCache = Object.create(null);
    var _calcScoreCacheOrder = [];
    var _calcScoreCacheMaxSize = 8000;
    var _cachedPartialAdds = null;
    var _preRestartBestScore = 0;
    var _preRestartBestState = null;
    var _restartedSeedIndices = {};


    function _setProgressTarget(pct) {
        _progressTarget = Math.max(_progressTarget, pct);
    }


    function _updateProgressBest(score, simState) {
        if (!(score > 0) || !simState) return;
        var savedSim = _simState;
        _simState = _cloneSimState(simState);
        _applyChefData();
        if (_checkGlobalMaterialFeasible() && score > _progressFeasibleBest) {
            _progressFeasibleBest = score;
            _progressFeasibleState = _cloneSimState(_simState);
            if (score > _progressDisplayScore) {
                _progressDisplayScore = score;
            }
        }
        _simState = savedSim;
    }


    function _startProgressTimer() {
        if (_progressTimer) return;
        var currentPct = 0;
        _progressTimer = setInterval(function() {
            if (currentPct < _progressTarget) {
                currentPct++;
                if (_onProgress) {
                    _onProgress({ progress: currentPct, score: _progressDisplayScore });
                }
            }
        }, 200);
    }


    function _stopProgressTimer(finalScoreOverride) {
        if (_progressTimer) {
            clearInterval(_progressTimer);
            _progressTimer = null;
        }
        if (_onProgress) {
            if (finalScoreOverride != null && finalScoreOverride > _progressDisplayScore) {
                _progressDisplayScore = finalScoreOverride;
            }
            _onProgress({ progress: 100, score: _progressDisplayScore });
        }
    }

    function init(gameData) {
        _stopProgressTimer();
        _bestResult = null;
        _isRunning = false;
        _targetScore = null;
        _gameData = gameData || null;
        _rule = null;
        _bestScore = 0;
        _simState = null;
        _bestSimState = null;
        _topCandidates = [];
        _availableEquips = [];
        _progressDisplayScore = 0;
        _progressTarget = 0;
        _progressFeasibleBest = 0;
        _progressFeasibleState = null;
        _newbieEquipEnabled = false;
        _newbiePoolEquips = [];
        _preRestartBestScore = 0;
        _preRestartBestState = null;
        _restartedSeedIndices = {};
        _clearCalcScoreCache();

        if (typeof calCustomRule === 'undefined' || !calCustomRule || !calCustomRule.rules || calCustomRule.rules.length === 0) {
            console.log('[厨神大赛] 无规则数据');
            return false;
        }

        _rule = calCustomRule.rules[0];
        if (!_rule) return false;
        
        // 厨神大赛不应有饱食度
        if (_rule.Satiety) {
            console.log('[厨神大赛] 检测到饱食度，这是风云宴规则，请使用风云宴优化器');
            return false;
        }

        // 缓存DOM配置
        _cachedConfig = {
            useGot: $("#chk-cal-got").prop("checked"),
            useEquip: $("#chk-cal-use-equip").prop("checked"),
            useAmber: $("#chk-cal-use-amber").prop("checked"),
            maxDisk: $("#chk-cal-max-disk").prop("checked"),
            autoCondiment: $("#chk-competition-auto-condiment").length ? $("#chk-competition-auto-condiment").prop("checked") : true,
            recipeRarity: $("#chk-cal-recipe-rarity").val() || [],
            recipeSkill: $("#chk-cal-recipe-skill").val() || [],
            multipleSkill: $("#chk-cal-recipe-multiple-skill").prop("checked"),
            recipeCondiment: $("#chk-cal-recipe-condiment").val() || [],
            excludeMaterials: $("#chk-cal-recipe-material-exclude").val() || [],
            selectedChefs: $("#select-competition-chefs").val() || []
        };

        // 检测是否需要自动搭配厨具遗玉
        _autoEquip = false;
        _autoAmber = false;
        _autoEquipAmber = false;
        _autoCondiment = false;
        var _isDefaultCompetitionMode = (typeof window.isDefaultCompetitionMode === 'function')
            ? window.isDefaultCompetitionMode()
            : ((new URLSearchParams(window.location.search)).get('chushen') !== '123');
        _newbieEquipEnabled = _isDefaultCompetitionMode &&
            typeof window.getCompetitionDefaultNewbieEquipEnabled === 'function' &&
            !!window.getCompetitionDefaultNewbieEquipEnabled();
        if (_simpleMode) {
            console.log('[厨神大赛-简化版] 不自动搭配厨具遗玉，未勾选时按空状态计算');
        }
        console.log('[厨神大赛] 自动搭配调料: 关闭');

        // 全局食材池
        _materialsAll = calCustomRule.materialsAll || null;
        _availableEquips = [];
        _newbiePoolEquips = _filterNewbiePoolEquips(_rule.equips || []);
        if (_newbieEquipEnabled) {
            console.log('[厨神大赛-简化版] 新手奖池厨具自动搭配: 开启 (' +
                (_cachedConfig.useEquip ? '勾选已配厨具时仅补无厨具厨师' : '未勾选已配厨具时全员自动搭配') +
                ', 新手厨具' + _newbiePoolEquips.length + '个)');
        }

        // 构建快速查找表
        _chefMap = {};
        _recipeMap = {};
        _menus = [];

        // 厨师过滤：如果选择了特定厨师，只使用选中的厨师
        var _selectedChefSet = null;
        if (_cachedConfig.selectedChefs && _cachedConfig.selectedChefs.length > 0) {
            _selectedChefSet = {};
            for (var sci = 0; sci < _cachedConfig.selectedChefs.length; sci++) {
                _selectedChefSet[_cachedConfig.selectedChefs[sci]] = true;
            }
        }

        if (_rule.chefs) {
            for (var ci = 0; ci < _rule.chefs.length; ci++) {
                if (_selectedChefSet && !_selectedChefSet[_rule.chefs[ci].chefId]) continue;
                _chefMap[_rule.chefs[ci].chefId] = _rule.chefs[ci];
            }
        }

        if (_rule.menus) {
            for (var mi = 0; mi < _rule.menus.length; mi++) {
                var recipe = _rule.menus[mi].recipe;
                if (!recipe || !recipe.data) continue;
                var rd = recipe.data;
                if (_cachedConfig.useGot && !rd.got && !isAllUltimateMode) continue;
                if (_cachedConfig.recipeRarity.length > 0 && _cachedConfig.recipeRarity.indexOf(rd.rarity.toString()) < 0) continue;
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
                if (_cachedConfig.recipeCondiment.length > 0 && _cachedConfig.recipeCondiment.indexOf(rd.condiment) < 0) continue;
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
                _menus.push(rd);
                _recipeMap[rd.recipeId] = rd;
            }
        }

        var _chefCount = Object.keys(_chefMap).length;
        _singleTrio = (_chefCount === 3);
        
        // 统计三星遗玉数量
        var _threeStarAmberCount = 0;
        var _totalAmberCount = 0;
        if (_rule.ambers) {
            _totalAmberCount = _rule.ambers.length;
            for (var ai = 0; ai < _rule.ambers.length; ai++) {
                if (_rule.ambers[ai].rarity === 3) {
                    _threeStarAmberCount++;
                }
            }
        }
        
        console.log('[厨神大赛] 初始化完成: 厨师' + _chefCount + '个' + (_selectedChefSet ? '(已选' + _cachedConfig.selectedChefs.length + '个)' : '') + ', 菜谱' + _menus.length + '个' + (_singleTrio ? ' (唯一三元组模式)' : ''));
        if (_totalAmberCount > 0) {
            console.log('[厨神大赛] 遗玉优化: 同分时三星遗玉优先 (三星' + _threeStarAmberCount + '个，总计' + _totalAmberCount + '个)');
        }
        if (_materialsAll) console.log('[厨神大赛] 有全局食材限制');
        if (_rule.RecipeEffect) console.log('[厨神大赛] 有菜谱加成规则');
        if (_rule.ChefTagEffect) console.log('[厨神大赛] 有厨师标签加成规则');
        if (_rule.PassLine) console.log('[厨神大赛] 档位分数线:', JSON.stringify(_rule.PassLine));

        return true;
    }


    function _initSimState() {
        _simState = [[]];
        for (var ci = 0; ci < 3; ci++) {
            _simState[0].push({
                chefId: null,
                chefObj: null,
                equipObj: {},
                condiment: {},  // 添加调料字段
                recipes: [
                    {data: null, quantity: 0, max: 0},
                    {data: null, quantity: 0, max: 0},
                    {data: null, quantity: 0, max: 0}
                ]
            });
        }
    }


    function _cloneSimState(state) {
        if (!state) return null;
        var clone = [[]];
        for (var ci = 0; ci < state[0].length; ci++) {
            var s = state[0][ci];
            clone[0].push({
                chefId: s.chefId,
                chefObj: s.chefObj ? JSON.parse(JSON.stringify(s.chefObj)) : null,
                equipObj: s.equipObj ? JSON.parse(JSON.stringify(s.equipObj)) : {},
                condiment: s.condiment ? JSON.parse(JSON.stringify(s.condiment)) : {},
                recipes: [
                    {data: s.recipes[0].data, quantity: s.recipes[0].quantity, max: s.recipes[0].max},
                    {data: s.recipes[1].data, quantity: s.recipes[1].quantity, max: s.recipes[1].max},
                    {data: s.recipes[2].data, quantity: s.recipes[2].quantity, max: s.recipes[2].max}
                ]
            });
        }
        return clone;
    }


    function _getStateRecipeSignature(state, ignoreChefOrder) {
        if (!state || !state[0]) return '';
        var slotParts = [];

        for (var ci = 0; ci < state[0].length; ci++) {
            var slot = state[0][ci] || {};
            var recipeParts = [];
            for (var ri = 0; ri < 3; ri++) {
                var rec = slot.recipes && slot.recipes[ri] ? slot.recipes[ri] : null;
                recipeParts.push(rec && rec.data ? rec.data.recipeId : 0);
            }

            if (ignoreChefOrder) {
                slotParts.push((slot.chefId || 0) + ':' + recipeParts.sort(function(a, b) { return a - b; }).join('-'));
            } else {
                slotParts.push('P' + ci + ':' + (slot.chefId || 0) + ':' + recipeParts.join('-'));
            }
        }

        if (ignoreChefOrder) {
            slotParts.sort();
        }

        return slotParts.join('|');
    }


    function _getStateChefKey(state, keepOrder) {
        if (!state || !state[0]) return '';
        var ids = [];
        for (var ci = 0; ci < state[0].length; ci++) {
            ids.push(state[0][ci] && state[0][ci].chefId ? state[0][ci].chefId : 0);
        }
        if (!keepOrder) {
            ids.sort();
        }
        return ids.join(',');
    }


    function _simSetChef(chefIndex, chefId) {
        var slot = _simState[0][chefIndex];
        if (!chefId) {
            slot.chefId = null;
            slot.chefObj = null;
            slot.equipObj = {};
            slot.condiment = {};  // 清空调料
            return;
        }

        var srcChef = null;
        for (var i = 0; i < _rule.chefs.length; i++) {
            if (_rule.chefs[i].chefId === chefId) {
                srcChef = _rule.chefs[i];
                break;
            }
        }
        if (!srcChef) return;

        slot.chefId = chefId;
        slot.chefObj = JSON.parse(JSON.stringify(srcChef));
        slot.condiment = {};  // 初始化调料

        if (_cachedConfig.maxDisk) {
            slot.chefObj.disk.level = slot.chefObj.disk.maxLevel;
        }
        if (!_cachedConfig.useAmber) {
            for (var ai = 0; ai < slot.chefObj.disk.ambers.length; ai++) {
                slot.chefObj.disk.ambers[ai].data = null;
            }
        }
        if (_cachedConfig.useEquip && srcChef.equipId) {
            slot.equipObj = getEquipInfo(srcChef.equipId, _rule.equips) || {};
        } else {
            slot.equipObj = {};
        }

        _applyChefData();
    }


    function _calcGlobalRemainMaterials(excludeChef, excludeRecipe) {
        if (!_materialsAll) return null;
        var remain = JSON.parse(JSON.stringify(_materialsAll));
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                if (ci === excludeChef && ri === excludeRecipe) continue;
                var rec = _simState[0][ci].recipes[ri];
                if (rec.data && rec.quantity > 0) {
                    for (var m = 0; m < rec.data.materials.length; m++) {
                        var mat = rec.data.materials[m];
                        var qty = calMaterialReduce(_simState[0][ci].chefObj, mat.material, mat.quantity);
                        remain[mat.material] -= qty * rec.quantity;
                    }
                }
            }
        }
        return remain;
    }


    function _calcRemainMaterials(excludeChef, excludeRecipe) {
        var remainMaterials = JSON.parse(JSON.stringify(_rule.materials));
        var ruleState = _simState[0];
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

    function _sanitizeRecipeQuantityValue(qty) {
        if (qty == null || !isFinite(qty)) return 0;
        qty = Math.floor(qty);
        return qty < 0 ? 0 : qty;
    }

    function _hasInvalidRecipeQuantities() {
        if (!_simState || !_simState[0]) return false;
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                var rec = _simState[0][ci].recipes[ri];
                if (!rec || !rec.data) continue;
                if (rec.quantity == null || !isFinite(rec.quantity) || rec.quantity < 0) {
                    return true;
                }
            }
        }
        return false;
    }

    function _sanitizeSimStateRecipeQuantities() {
        if (!_simState || !_simState[0]) return false;
        var changed = false;
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                var rec = _simState[0][ci].recipes[ri];
                if (!rec) continue;

                var safeMax = _sanitizeRecipeQuantityValue(rec.max);
                if (rec.max !== safeMax) {
                    rec.max = safeMax;
                    changed = true;
                }

                if (!rec.data) {
                    if (rec.quantity !== 0 || rec.max !== 0) {
                        rec.quantity = 0;
                        rec.max = 0;
                        changed = true;
                    }
                    continue;
                }

                var safeQty = _sanitizeRecipeQuantityValue(rec.quantity);
                if (rec.quantity !== safeQty) {
                    rec.quantity = safeQty;
                    changed = true;
                }
            }
        }
        return changed;
    }


    function _checkGlobalMaterialFeasible() {
        if (!_materialsAll || !_rule.MaterialsLimit) return true;
        if (_hasInvalidRecipeQuantities()) return false;
        var totalUsed = {};
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                var rec = _simState[0][ci].recipes[ri];
                if (rec.data && rec.quantity > 0) {
                    for (var m = 0; m < rec.data.materials.length; m++) {
                        var mat = rec.data.materials[m];
                        var qty = calMaterialReduce(_simState[0][ci].chefObj, mat.material, mat.quantity);
                        if (!totalUsed[mat.material]) totalUsed[mat.material] = 0;
                        totalUsed[mat.material] += qty * rec.quantity;
                    }
                }
            }
        }
        for (var matId in totalUsed) {
            var available = _materialsAll[matId] || 0;
            if (totalUsed[matId] > available) return false;
        }
        return true;
    }


    function _isRecipeSkillFeasible(chefObj, recipeData) {
        if (!recipeData || !chefObj || !chefObj.chefId) return true;
        if (recipeData.stirfry > 0 && (!chefObj.stirfryVal || chefObj.stirfryVal < recipeData.stirfry)) return false;
        if (recipeData.boil > 0 && (!chefObj.boilVal || chefObj.boilVal < recipeData.boil)) return false;
        if (recipeData.knife > 0 && (!chefObj.knifeVal || chefObj.knifeVal < recipeData.knife)) return false;
        if (recipeData.fry > 0 && (!chefObj.fryVal || chefObj.fryVal < recipeData.fry)) return false;
        if (recipeData.bake > 0 && (!chefObj.bakeVal || chefObj.bakeVal < recipeData.bake)) return false;
        if (recipeData.steam > 0 && (!chefObj.steamVal || chefObj.steamVal < recipeData.steam)) return false;
        return true;
    }


    function _fixSkillInvalidRecipes() {
        for (var ci = 0; ci < _simState[0].length; ci++) {
            var chefObj = _simState[0][ci].chefObj;
            if (!chefObj || !chefObj.chefId) continue;

            for (var ri = 0; ri < 3; ri++) {
                var rec = _simState[0][ci].recipes[ri];
                if (!rec || !rec.data) continue;

                if (_isRecipeSkillFeasible(chefObj, rec.data)) continue;

                var ranking = _fastGetRecipeRanking(ci, ri, 10, true);
                var repaired = false;
                for (var rki = 0; rki < ranking.length; rki++) {
                    _simSetRecipe(ci, ri, ranking[rki].recipeId);
                    var replaced = _simState[0][ci].recipes[ri];
                    if (replaced && replaced.data && _isRecipeSkillFeasible(chefObj, replaced.data)) {
                        repaired = true;
                        break;
                    }
                }
                if (!repaired) {
                    _simState[0][ci].recipes[ri] = {data: null, quantity: 0, max: 0};
                }
            }
        }

        _applyChefData();

        for (var ci2 = 0; ci2 < _simState[0].length; ci2++) {
            var chefObj2 = _simState[0][ci2].chefObj;
            if (!chefObj2 || !chefObj2.chefId) continue;
            for (var ri2 = 0; ri2 < 3; ri2++) {
                var rec2 = _simState[0][ci2].recipes[ri2];
                if (rec2 && rec2.data && !_isRecipeSkillFeasible(chefObj2, rec2.data)) {
                    _simState[0][ci2].recipes[ri2] = {data: null, quantity: 0, max: 0};
                }
            }
        }

        _applyChefData();

        for (var ci3 = 0; ci3 < _simState[0].length; ci3++) {
            var chefObj3 = _simState[0][ci3].chefObj;
            if (!chefObj3 || !chefObj3.chefId) continue;
            for (var ri3 = 0; ri3 < 3; ri3++) {
                var rec3 = _simState[0][ci3].recipes[ri3];
                if (rec3 && rec3.data && !_isRecipeSkillFeasible(chefObj3, rec3.data)) {
                    return false;
                }
            }
        }

        return true;
    }


    function _normalizeFeasibleState(simState) {
        var savedState = _simState;
        try {
            _simState = _cloneSimState(simState);
            _sanitizeSimStateRecipeQuantities();
            _applyChefData();

            if (!_fixSkillInvalidRecipes()) {
                return null;
            }

            if (!_checkGlobalMaterialFeasible()) {
                _sanitizeSimStateRecipeQuantities();
                _fixGlobalMaterialOverflow();
                _sanitizeSimStateRecipeQuantities();
                _applyChefData();
                if (!_checkGlobalMaterialFeasible()) {
                    return null;
                }
            }

            return {
                score: _calcScore(),
                state: _cloneSimState(_simState)
            };
        } finally {
            _simState = savedState;
            _applyChefData();
        }
    }


    function _normalizeBestState(label) {
        if (!_bestSimState) return false;
        var normalized = _normalizeFeasibleState(_bestSimState);
        if (!normalized) {
            console.warn('[厨神大赛] 最佳状态不可规范化: ' + (label || '未知来源'));
            return false;
        }
        _bestScore = normalized.score;
        _bestSimState = _cloneSimState(normalized.state);
        _simState = _cloneSimState(_bestSimState);
        return true;
    }


    function _fixGlobalMaterialOverflow() {
            if (!_materialsAll || !_rule.MaterialsLimit) return;
            var maxIter = 50; // 批量砍后迭代次数大幅减少
            for (var iter = 0; iter < maxIter; iter++) {
                // 计算每种食材的总消耗
                var totalUsed = {};
                for (var ci = 0; ci < _simState[0].length; ci++) {
                    for (var ri = 0; ri < 3; ri++) {
                        var rec = _simState[0][ci].recipes[ri];
                        if (rec.data && rec.quantity > 0) {
                            for (var m = 0; m < rec.data.materials.length; m++) {
                                var mat = rec.data.materials[m];
                                var qty = calMaterialReduce(_simState[0][ci].chefObj, mat.material, mat.quantity);
                                if (!totalUsed[mat.material]) totalUsed[mat.material] = 0;
                                totalUsed[mat.material] += qty * rec.quantity;
                            }
                        }
                    }
                }
                // 找超量最多的食材（优先处理超量最严重的）
                var overflowMat = null;
                var overflowAmount = 0;
                for (var matId in totalUsed) {
                    var available = _materialsAll[matId] || 0;
                    if (totalUsed[matId] > available && (totalUsed[matId] - available) > overflowAmount) {
                        overflowMat = matId;
                        overflowAmount = totalUsed[matId] - available;
                    }
                }
                if (!overflowMat) return; // 没有超量，完成

                // 找使用该食材的所有菜谱，计算每单位食材的分数损失
                var candidates = [];
                for (var ci = 0; ci < _simState[0].length; ci++) {
                    for (var ri = 0; ri < 3; ri++) {
                        var rec = _simState[0][ci].recipes[ri];
                        if (rec.data && rec.quantity > 0) {
                            var perUnit = 0;
                            for (var m = 0; m < rec.data.materials.length; m++) {
                                if (rec.data.materials[m].material.toString() === overflowMat.toString()) {
                                    perUnit = calMaterialReduce(_simState[0][ci].chefObj, rec.data.materials[m].material, rec.data.materials[m].quantity);
                                    break;
                                }
                            }
                            if (perUnit > 0) {
                                candidates.push({ci: ci, ri: ri, rec: rec, perUnit: perUnit});
                            }
                        }
                    }
                }
                if (candidates.length === 0) return;

                // 对每个候选，试减1，按每单位食材的分数损失排序（损失小的优先砍）
                var curScore = _calcScore();
                for (var k = 0; k < candidates.length; k++) {
                    var c = candidates[k];
                    var savedQty = c.rec.quantity;
                    c.rec.quantity = savedQty - 1;
                    var newScore = _calcScore();
                    c.lossPerUnit = (curScore - newScore) / c.perUnit;
                    c.rec.quantity = savedQty;
                }
                candidates.sort(function(a, b) { return a.lossPerUnit - b.lossPerUnit; });

                // 批量砍：从损失最小的候选开始，尽量一次砍多份
                var remaining = overflowAmount;
                for (var k = 0; k < candidates.length && remaining > 0; k++) {
                    var c = candidates[k];
                    if (c.rec.quantity <= 0) continue;
                    var canCut = Math.min(c.rec.quantity, Math.ceil(remaining / c.perUnit));
                    if (canCut <= 0) continue;
                    var oldQty = c.rec.quantity;
                    c.rec.quantity = oldQty - canCut;
                    remaining -= canCut * c.perUnit;
                }
            }
        }

    function _tryInsertTop10Feasible(score, simState, source) {
        return false;
    }

    function _logCurrentCombo(label, score) {
        console.log('[厨神大赛] ★' + score + ' (' + label + ')');
    }

    function _simSetRecipe(chefIndex, recipeIndex, recipeId) {
        var slot = _simState[0][chefIndex];
        if (!recipeId) {
            slot.recipes[recipeIndex] = {data: null, quantity: 0, max: 0};
            return;
        }

        // 去重检查：同一菜谱不能出现在多个位置
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                if (ci === chefIndex && ri === recipeIndex) continue;
                var existRec = _simState[0][ci].recipes[ri];
                if (existRec.data && existRec.data.recipeId === recipeId) {
                    // 菜谱已被使用，不设置
                    return;
                }
            }
        }

        var recipeData = _recipeMap[recipeId];
        if (!recipeData) {
            if (_rule.menus) {
                for (var i = 0; i < _rule.menus.length; i++) {
                    if (_rule.menus[i].recipe.data.recipeId === recipeId) {
                        recipeData = _rule.menus[i].recipe.data;
                        _recipeMap[recipeId] = recipeData;
                        break;
                    }
                }
            }
        }
        if (!recipeData) return;

        if (slot.chefObj && slot.chefObj.chefId && !_isRecipeSkillFeasible(slot.chefObj, recipeData)) {
            return;
        }

        var remainMaterials = _calcRemainMaterials(chefIndex, recipeIndex);
        var qty = getRecipeQuantity(recipeData, remainMaterials, _rule, slot.chefObj);

        // 全局食材限制
        if (_rule.MaterialsLimit && _materialsAll) {
            var globalRemain = _calcGlobalRemainMaterials(chefIndex, recipeIndex);
            var materialLimit = calculateMaterialLimit(globalRemain, recipeData, slot.chefObj);
            qty = Math.min(qty, materialLimit);
        }

        if (_rule.DisableMultiCookbook) qty = Math.min(qty, 1);
        qty = _sanitizeRecipeQuantityValue(qty);

        slot.recipes[recipeIndex] = {data: recipeData, quantity: qty, max: qty};
    }


    function _applyChefData() {
        var ruleState = _simState[0];
        var customArr = [];
        for (var ci = 0; ci < ruleState.length; ci++) {
            customArr.push({
                chef: ruleState[ci].chefObj || {},
                equip: ruleState[ci].equipObj || {},
                recipes: ruleState[ci].recipes,
                condiment: {}
            });
        }

        var partialAdds = getPartialChefAdds(customArr, _rule);
        // 缓存partialAdds供_applyChefDataSingle使用
        _cachedPartialAdds = partialAdds;

        for (var ci = 0; ci < ruleState.length; ci++) {
            if (ruleState[ci].chefObj && ruleState[ci].chefObj.chefId) {
                setDataForChef(
                    ruleState[ci].chefObj,
                    ruleState[ci].equipObj,
                    true,
                    _rule.calGlobalUltimateData,
                    partialAdds[ci],
                    _rule.calSelfUltimateData,
                    _rule.calActivityUltimateData,
                    true,
                    _rule,
                    true,
                    _rule.calQixiaData || null
                );
            }
        }
    }


    function _applyChefDataSingle(chefIndex) {
        var ruleState = _simState[0];
        if (!_cachedPartialAdds) {
            // 没有缓存，退化为全量计算
            _applyChefData();
            return;
        }
        if (ruleState[chefIndex].chefObj && ruleState[chefIndex].chefObj.chefId) {
            setDataForChef(
                ruleState[chefIndex].chefObj,
                ruleState[chefIndex].equipObj,
                true,
                _rule.calGlobalUltimateData,
                _cachedPartialAdds[chefIndex],
                _rule.calSelfUltimateData,
                _rule.calActivityUltimateData,
                true,
                _rule,
                true,
                _rule.calQixiaData || null
            );
        }
    }


    function _filterNewbiePoolEquips(equips) {
        var results = [];
        for (var i = 0; i < equips.length; i++) {
            var equip = equips[i];
            if (!equip) continue;
            var origin = equip.origin || '';
            if (origin.indexOf('新手奖池') >= 0) results.push(equip);
        }
        return results;
    }


    function _chefHasRecipes(chefIndex) {
        var slot = _simState[0][chefIndex];
        for (var ri = 0; ri < 3; ri++) {
            if (slot.recipes[ri].data) return true;
        }
        return false;
    }


    function _shouldAutoFitNewbieEquipForChef(chefIndex) {
        if (!_newbieEquipEnabled || !_newbiePoolEquips.length) return false;
        var slot = _simState[0][chefIndex];
        if (!slot || !slot.chefObj || !slot.chefObj.chefId) return false;
        if (!_chefHasRecipes(chefIndex)) return false;
        if (_cachedConfig.useEquip) {
            return !(slot.equipObj && slot.equipObj.equipId);
        }
        return true;
    }


    function _refreshRecipeQuantitiesForChef(chefIndex) {
        var slot = _simState[0][chefIndex];
        if (!slot || !slot.chefObj) return;
        for (var ri = 0; ri < 3; ri++) {
            var rec = slot.recipes[ri];
            if (!rec.data) continue;
            var newMax = getRecipeQuantity(rec.data, _rule.materials, _rule, slot.chefObj);
            if (_rule.MaterialsLimit && _materialsAll) {
                var matMax = calculateMaterialLimit(_materialsAll, rec.data, slot.chefObj);
                newMax = Math.min(newMax, matMax);
            }
            if (_rule.DisableMultiCookbook) newMax = Math.min(newMax, 1);
            rec.max = newMax;
            if (rec.quantity > newMax) rec.quantity = newMax;
            if (newMax > rec.quantity) rec.quantity = newMax;
        }
    }


    function _rankNewbieEquipsForChef(chefIndex) {
        if (!_shouldAutoFitNewbieEquipForChef(chefIndex)) return [];

        var savedState = _cloneSimState(_simState);
        var results = [];

        for (var i = 0; i < _newbiePoolEquips.length; i++) {
            _simState = _cloneSimState(savedState);
            _simState[0][chefIndex].equipObj = _newbiePoolEquips[i];
            _applyChefData();
            _refreshRecipeQuantitiesForChef(chefIndex);
            var score = _calcScore();
            results.push({
                equipObj: _newbiePoolEquips[i],
                score: score
            });
        }

        _simState = _cloneSimState(savedState);
        results.sort(function(a, b) { return b.score - a.score; });
        return results;
    }


    function _fitNewbieEquipForChef(chefIndex) {
        if (!_shouldAutoFitNewbieEquipForChef(chefIndex)) return false;
        var ranked = _rankNewbieEquipsForChef(chefIndex);
        if (!ranked.length || !ranked[0].equipObj) return false;

        var slot = _simState[0][chefIndex];
        var currentEquipId = slot.equipObj && slot.equipObj.equipId ? slot.equipObj.equipId : null;
        if (currentEquipId === ranked[0].equipObj.equipId) return false;

        slot.equipObj = ranked[0].equipObj;
        _applyChefData();
        _refreshRecipeQuantitiesForChef(chefIndex);
        return true;
    }


    function _fitNewbieEquipsForCurrentState() {
        if (!_newbieEquipEnabled || !_newbiePoolEquips.length) return false;
        var improved = false;
        var startScore = _calcScore();
        for (var ci = 0; ci < 3; ci++) {
            if (_fitNewbieEquipForChef(ci)) improved = true;
        }
        if (improved) {
            var fittedScore = _calcScore();
            console.log('[厨神大赛-简化版] 新手奖池厨具自动搭配: ' + startScore + '→' + fittedScore + ' (+' + (fittedScore - startScore) + ')');
        }
        return improved;
    }


    function _getChefPermutations(quickMode) {
        if (_singleTrio) {
            return [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
        }
        if (quickMode) {
            return [[0, 1, 2], [2, 1, 0]];
        }
        return [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    }


    function _syncRecipeDataFromMenus() {
        if (!_rule || !_rule.menus) return;
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                var rec = _simState[0][ci].recipes[ri];
                if (!rec.data) continue;
                for (var mi = 0; mi < _rule.menus.length; mi++) {
                    if (_rule.menus[mi].recipe.data.recipeId === rec.data.recipeId) {
                        rec.data = _rule.menus[mi].recipe.data;
                        break;
                    }
                }
            }
        }
    }


    function _clearCalcScoreCache() {
        _calcScoreCache = Object.create(null);
        _calcScoreCacheOrder = [];
    }


    function _buildCalcScoreCacheKey(ruleState) {
        var parts = [];
        for (var ci = 0; ci < ruleState.length; ci++) {
            var slot = ruleState[ci];
            var chef = slot.chefObj || {};
            var equip = slot.equipObj || {};
            var condiment = slot.condiment || {};
            var chefDisk = chef.disk && chef.disk.ambers ? chef.disk.ambers : [];

            parts.push('C', ci, ':', slot.chefId || 0);
            parts.push('|E', equip.equipId || 0);
            parts.push('|D', condiment.condimentId || 0);

            for (var ai = 0; ai < chefDisk.length; ai++) {
                var amber = chefDisk[ai] && chefDisk[ai].data ? chefDisk[ai].data : null;
                parts.push('|A', ai, ':', amber ? amber.amberId : 0);
            }

            var recipes = slot.recipes;
            for (var ri = 0; ri < recipes.length; ri++) {
                var rec = recipes[ri];
                var recData = rec.data;
                parts.push('|R', ri, ':', recData ? recData.recipeId : 0, '#', rec.quantity || 0);
            }
        }
        return parts.join('');
    }


    function _setCalcScoreCache(key, score) {
        if (!Object.prototype.hasOwnProperty.call(_calcScoreCache, key)) {
            _calcScoreCacheOrder.push(key);
            if (_calcScoreCacheOrder.length > _calcScoreCacheMaxSize) {
                var oldKey = _calcScoreCacheOrder.shift();
                delete _calcScoreCache[oldKey];
            }
        }
        _calcScoreCache[key] = score;
    }


    function _getCalcScoreCache(key) {
        if (Object.prototype.hasOwnProperty.call(_calcScoreCache, key)) {
            return _calcScoreCache[key];
        }
        return null;
    }


    function _calcScore() {
        _applyChefData();

        var rule = _rule;
        var ruleState = _simState[0];
        var materials = rule.materials;
        var hasMaterialsLimit = rule.MaterialsLimit && _materialsAll;
        var disableMultiCookbook = rule.DisableMultiCookbook;
        var stateLen = ruleState.length;

        // 重算份数上限（与系统calCustomResults一致：用全量食材池算max，不用剩余量）
        for (var ci = 0; ci < stateLen; ci++) {
            var slot = ruleState[ci];
            var chefObj = slot.chefObj;
            var recipes = slot.recipes;
            for (var reci = 0; reci < 3; reci++) {
                var rec = recipes[reci];
                var recData = rec.data;
                if (recData) {
                    var recipeMax = getRecipeQuantity(recData, materials, rule, chefObj);
                    if (hasMaterialsLimit) {
                        var matLimit = calculateMaterialLimit(_materialsAll, recData, chefObj);
                        recipeMax = Math.min(recipeMax, matLimit);
                    }
                    if (disableMultiCookbook) recipeMax = Math.min(recipeMax, 1);
                    rec.max = recipeMax;
                    if (rec.quantity > recipeMax) rec.quantity = recipeMax;
                }
            }
        }

        var cacheKey = _buildCalcScoreCacheKey(ruleState);
        var cachedScore = _getCalcScoreCache(cacheKey);
        if (cachedScore !== null) {
            return cachedScore;
        }

        var customArr = [];
        for (var ci2 = 0; ci2 < stateLen; ci2++) {
            var slot2 = ruleState[ci2];
            customArr.push({
                chef: slot2.chefObj || {},
                equip: slot2.equipObj || {},
                recipes: slot2.recipes,
                condiment: slot2.condiment || {}  // 包含调料
            });
        }

        var partialRecipeAdds = getPartialRecipeAdds(customArr, rule);
        // 无意图：传null使getRecipeResult执行Math.floor(J)，与页面一致

        var u = 0;
        for (var ci3 = 0; ci3 < stateLen; ci3++) {
            var slot3 = ruleState[ci3];
            var recipes3 = slot3.recipes;
            var chefObj3 = slot3.chefObj;
            var equipObj3 = slot3.equipObj;
            var condiment3 = slot3.condiment;
            var condimentForRecipe = (condiment3 && condiment3.condimentId) ? condiment3 : null;
            var partialBaseIdx = 3 * ci3;

            for (var reci3 = 0; reci3 < 3; reci3++) {
                var rec3 = recipes3[reci3];
                var recData3 = rec3.data;
                if (recData3) {
                    var g = getRecipeResult(
                        chefObj3,
                        equipObj3,
                        recData3,
                        rec3.quantity,
                        rec3.max,
                        materials,
                        rule,
                        rule.decorationEffect,
                        condimentForRecipe,  // 传递调料对象
                        true,
                        customArr[ci3].recipes,
                        partialRecipeAdds[partialBaseIdx + reci3],
                        null
                    );
                    var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
                    u += Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));
                }
            }
        }

        var h = 1;
        if (rule.hasOwnProperty("scoreMultiply")) h = rule.scoreMultiply;
        var m = 1;
        if (rule.hasOwnProperty("scorePow")) m = rule.scorePow;
        var v = 0;
        if (rule.hasOwnProperty("scoreAdd")) v = rule.scoreAdd;

        u = +(Math.pow(u, m) * h).toFixed(2);
        u = rule.IsActivity ? Math.ceil(u) : Math.floor(u);
        if (u) u += v;

        _setCalcScoreCache(cacheKey, u);
        return u;
    }


    function _calcScoreWithRemainingMaterials() {
        _applyChefData();

        var rule = _rule;
        var ruleState = _simState[0];
        var materials = rule.materials;
        var hasMaterialsLimit = rule.MaterialsLimit && _materialsAll;
        var disableMultiCookbook = rule.DisableMultiCookbook;
        var stateLen = ruleState.length;

        // 重算份数上限（使用全部可用食材，不考虑其他菜谱占用）
        for (var ci = 0; ci < stateLen; ci++) {
            var slot = ruleState[ci];
            var chefObj = slot.chefObj;
            var recipes = slot.recipes;
            for (var reci = 0; reci < 3; reci++) {
                var rec = recipes[reci];
                var recData = rec.data;
                if (recData) {
                    var recipeMax = getRecipeQuantity(recData, materials, rule, chefObj);

                    if (hasMaterialsLimit) {
                        // ★ 使用全部可用食材计算理论最大份数（不考虑其他菜谱的占用）
                        // 直接使用全局食材池，不减去其他菜谱的消耗
                        var matLimit = calculateMaterialLimit(_materialsAll, recData, chefObj);
                        recipeMax = Math.min(recipeMax, matLimit);
                    }

                    if (disableMultiCookbook) recipeMax = Math.min(recipeMax, 1);
                    rec.max = recipeMax;
                    rec.quantity = recipeMax; // ★ 直接设置为最大份数
                }
            }
        }

        var customArr = [];
        for (var ci2 = 0; ci2 < stateLen; ci2++) {
            var slot2 = ruleState[ci2];
            customArr.push({
                chef: slot2.chefObj || {},
                equip: slot2.equipObj || {},
                recipes: slot2.recipes,
                condiment: slot2.condiment || {}
            });
        }

        var partialRecipeAdds = getPartialRecipeAdds(customArr, rule);

        var u = 0;
        for (var ci3 = 0; ci3 < stateLen; ci3++) {
            var slot3 = ruleState[ci3];
            var recipes3 = slot3.recipes;
            var chefObj3 = slot3.chefObj;
            var equipObj3 = slot3.equipObj;
            var condiment3 = slot3.condiment;
            var condimentForRecipe = (condiment3 && condiment3.condimentId) ? condiment3 : null;
            var partialBaseIdx = 3 * ci3;

            for (var reci3 = 0; reci3 < 3; reci3++) {
                var rec3 = recipes3[reci3];
                var recData3 = rec3.data;
                if (recData3) {
                    var g = getRecipeResult(
                        chefObj3,
                        equipObj3,
                        recData3,
                        rec3.quantity,
                        rec3.max,
                        materials,
                        rule,
                        rule.decorationEffect,
                        condimentForRecipe,
                        true,
                        customArr[ci3].recipes,
                        partialRecipeAdds[partialBaseIdx + reci3],
                        null
                    );
                    var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
                    u += Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));
                }
            }
        }

        var h = 1;
        if (rule.hasOwnProperty("scoreMultiply")) h = rule.scoreMultiply;
        var m = 1;
        if (rule.hasOwnProperty("scorePow")) m = rule.scorePow;
        var v = 0;
        if (rule.hasOwnProperty("scoreAdd")) v = rule.scoreAdd;

        u = +(Math.pow(u, m) * h).toFixed(2);
        u = rule.IsActivity ? Math.ceil(u) : Math.floor(u);
        if (u) u += v;

        return u;
    }


    function _isTargetReached() {
        return _targetScore && _bestScore >= _targetScore;
    }


    function _getChefNameById(chefId) {
        if (!chefId) return '?';
        var chef = _chefMap[chefId];
        return chef ? chef.name : '?';
    }


    function _getUsedChefIds(excludeChef) {
        var used = {};
        for (var ci = 0; ci < _simState[0].length; ci++) {
            if (ci === excludeChef) continue;
            if (_simState[0][ci].chefId) used[_simState[0][ci].chefId] = true;
        }
        return used;
    }


    function _getUsedRecipeIds(excludeChef, excludeRecipe) {
        var used = {};
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                if (ci === excludeChef && reci === excludeRecipe) continue;
                var rec = _simState[0][ci].recipes[reci];
                if (rec.data) used[rec.data.recipeId] = true;
            }
        }
        return used;
    }


    function _selectSingleTrioSearchCandidates(candidates, limit) {
        if (!candidates || candidates.length <= limit) return candidates || [];

        var selected = [];
        var seen = {};

        function _makeCandidateKey(candidate) {
            return _getStateChefKey(candidate.state, false) + '|' + _getStateRecipeSignature(candidate.state, false);
        }

        function _addCandidate(candidate) {
            if (!candidate) return false;
            var key = _makeCandidateKey(candidate);
            if (seen[key]) return false;
            seen[key] = true;
            selected.push(candidate);
            return true;
        }

        function _pickFirst(matchFn) {
            for (var i = 0; i < candidates.length; i++) {
                if (matchFn(candidates[i])) return candidates[i];
            }
            return null;
        }

        function _pickMany(matchFn, count) {
            var result = [];
            for (var i = 0; i < candidates.length && result.length < count; i++) {
                if (matchFn(candidates[i])) result.push(candidates[i]);
            }
            return result;
        }

        function _getREComboSize(source) {
            if (!source || source.indexOf('RE组合-') !== 0) return 0;
            return source.substring(5).split('+').length;
        }

        _addCandidate(candidates[0]);

        var twoRECombos = _pickMany(function(c) {
            return c.source && c.source.indexOf('RE组合-') === 0 && _getREComboSize(c.source) === 2;
        }, 2);
        for (var i2 = 0; i2 < twoRECombos.length; i2++) _addCandidate(twoRECombos[i2]);

        var multiRECombos = _pickMany(function(c) {
            return c.source && c.source.indexOf('RE组合-') === 0 && _getREComboSize(c.source) >= 3;
        }, 2);
        for (var i3 = 0; i3 < multiRECombos.length; i3++) _addCandidate(multiRECombos[i3]);

        _addCandidate(_pickFirst(function(c) { return c.source && c.source.indexOf('RecipeEffect-') === 0; }));
        _addCandidate(_pickFirst(function(c) { return c.source && c.source.indexOf('Fit排名-') === 0; }));
        _addCandidate(_pickFirst(function(c) { return c.source && c.source.indexOf('RE厨师-') === 0; }));

        for (var j = 0; j < candidates.length && selected.length < limit; j++) {
            _addCandidate(candidates[j]);
        }

        return selected.slice(0, limit);
    }


    function _fastGetChefRanking(chefIndex, fastMode) {
        var ruleState = _simState[0];

        var hasRecipe = false;
        for (var reci = 0; reci < 3; reci++) {
            if (ruleState[chefIndex].recipes[reci].data) {
                hasRecipe = true;
                break;
            }
        }

        var usedChefIds = _getUsedChefIds(chefIndex);
        var results = [];

        if (!hasRecipe) {
            for (var i = 0; i < _rule.chefs.length; i++) {
                var chef = _rule.chefs[i];
                if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
                if (!_chefMap[chef.chefId]) continue;
                results.push({
                    chefId: chef.chefId,
                    score: chef.rarity,
                    used: !!usedChefIds[chef.chefId]
                });
            }
        } else {
            var savedChefObj = ruleState[chefIndex].chefObj;
            var savedChefId = ruleState[chefIndex].chefId;
            var savedEquipObj = ruleState[chefIndex].equipObj;

            for (var i = 0; i < _rule.chefs.length; i++) {
                var chef = _rule.chefs[i];
                if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
                if (!_chefMap[chef.chefId]) continue;
                if (fastMode && usedChefIds[chef.chefId]) continue;

                _simSetChef(chefIndex, chef.chefId);

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

                if (!skillOk) {
                    results.push({ chefId: chef.chefId, score: -1, used: false, skillOk: false });
                    continue;
                }

                var score = _calcScore();
                results.push({
                    chefId: chef.chefId,
                    score: score,
                    used: !!usedChefIds[chef.chefId],
                    skillOk: true
                });
            }

            ruleState[chefIndex].chefId = savedChefId;
            ruleState[chefIndex].chefObj = savedChefObj;
            ruleState[chefIndex].equipObj = savedEquipObj;
            _applyChefData();
        }

        results.sort(function(a, b) { return b.score - a.score; });
        return results;
    }


    function _fastGetRecipeRanking(chefIndex, recipeIndex, topK, fastMode) {
        var ruleState = _simState[0];
        var usedRecipeIds = _getUsedRecipeIds(chefIndex, recipeIndex);
        var chefObj = ruleState[chefIndex].chefObj;
        var savedRecipe = ruleState[chefIndex].recipes[recipeIndex];
        var slotIdx = 3 * chefIndex + recipeIndex;

        // 预计算基准加成
        var baseCustomArr = [];
        for (var ci = 0; ci < ruleState.length; ci++) {
            baseCustomArr.push({
                chef: ruleState[ci].chefObj || {},
                equip: ruleState[ci].equipObj || {},
                recipes: ruleState[ci].recipes,
                condiment: {}
            });
        }
        var basePartialAdds = getPartialRecipeAdds(baseCustomArr, _rule);
        var slotPartialAdds = basePartialAdds[slotIdx];

        var preRemainMaterials = _calcRemainMaterials(chefIndex, recipeIndex);
        var preGlobalRemain = (_rule.MaterialsLimit && _materialsAll) ? _calcGlobalRemainMaterials(chefIndex, recipeIndex) : null;

        // ===== Phase1: 粗排 =====
        var phase1 = [];

        for (var i = 0; i < _menus.length; i++) {
            var rd = _menus[i];
            if (usedRecipeIds[rd.recipeId]) continue;

            if (chefObj && chefObj.chefId) {
                if (rd.stirfry > 0 && (!chefObj.stirfryVal || chefObj.stirfryVal < rd.stirfry)) continue;
                if (rd.boil > 0 && (!chefObj.boilVal || chefObj.boilVal < rd.boil)) continue;
                if (rd.knife > 0 && (!chefObj.knifeVal || chefObj.knifeVal < rd.knife)) continue;
                if (rd.fry > 0 && (!chefObj.fryVal || chefObj.fryVal < rd.fry)) continue;
                if (rd.bake > 0 && (!chefObj.bakeVal || chefObj.bakeVal < rd.bake)) continue;
                if (rd.steam > 0 && (!chefObj.steamVal || chefObj.steamVal < rd.steam)) continue;
            }

            var qty = getRecipeQuantity(rd, preRemainMaterials, _rule, chefObj);
            if (preGlobalRemain) {
                var matLimit = calculateMaterialLimit(preGlobalRemain, rd, chefObj);
                qty = Math.min(qty, matLimit);
            }
            if (_rule.DisableMultiCookbook) qty = Math.min(qty, 1);

            var tempRecipes = [
                ruleState[chefIndex].recipes[0],
                ruleState[chefIndex].recipes[1],
                ruleState[chefIndex].recipes[2]
            ];
            tempRecipes[recipeIndex] = {data: rd, quantity: qty, max: qty};

            var g = getRecipeResult(
                chefObj, ruleState[chefIndex].equipObj,
                rd, qty, qty, _rule.materials, _rule,
                _rule.decorationEffect, null, true,
                tempRecipes,
                slotPartialAdds,
                null
            );
            var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
            var est = Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));

            // RecipeEffect / ChefTagEffect 排名加权
            // 注意：est (totalScore) 已经包含了RE/ChefTag的加成（通过getRecipeResult）
            // 但totalScore = score × quantity，低份数的RE菜谱总分低，容易被过滤掉
            // 解决方案：用单份分数(perPortionScore)乘以一个放大系数来提升RE菜谱排名
            var isRERecipe = false;
            var reBonus = 0;
            if (_rule.RecipeEffect) {
                var reStr = rd.recipeId.toString();
                var reNum = Number(rd.recipeId);
                if (_rule.RecipeEffect[reStr] != null) {
                    reBonus = _rule.RecipeEffect[reStr];
                    isRERecipe = true;
                } else if (_rule.RecipeEffect[reNum] != null) {
                    reBonus = _rule.RecipeEffect[reNum];
                    isRERecipe = true;
                }
            }

            // 对RE菜谱：用单份分数×放大系数来排名，确保高RE加成的菜谱不会因为份数少而被过滤
            // 非RE菜谱：直接用totalScore
            var estWithBonus = est;
            if (isRERecipe && qty > 0) {
                var perPortion = est / qty;
                // RE菜谱的排名分 = max(totalScore, 单份分数 × 虚拟份数30)
                // 这样即使实际只有16份，排名时也不会被38份的普通菜谱压过
                var virtualTotal = perPortion * 30;
                estWithBonus = Math.max(est, virtualTotal);
            }
            phase1.push({rd: rd, qty: qty, est: est, estWithBonus: estWithBonus});
        }

        phase1.sort(function(a, b) { return b.estWithBonus - a.estWithBonus; });

        // Phase2: 条件型光环精排
        var needPhase2 = _hasConditionalPartialAdds();
        var phase2Size = needPhase2 ? (topK <= 3 ? (_simpleMode ? 2 : 8) : (_simpleMode ? 4 : 15)) : 0;
        var phase1Top = Math.max(topK || 10, CONFIG.preFilterTop);
        if (phase1.length > phase1Top) phase1.length = phase1Top;

        var phase2 = [];
        if (needPhase2 && phase2Size > 0) {
            var phase2Limit = Math.min(phase2Size, phase1.length);
            for (var i = 0; i < phase2Limit; i++) {
                var rd = phase1[i].rd;
                var qty = phase1[i].qty;

                var tempRecipes = [
                    ruleState[chefIndex].recipes[0],
                    ruleState[chefIndex].recipes[1],
                    ruleState[chefIndex].recipes[2]
                ];
                tempRecipes[recipeIndex] = {data: rd, quantity: qty, max: qty};

                var tempCustomArr = [];
                for (var ci = 0; ci < ruleState.length; ci++) {
                    if (ci === chefIndex) {
                        tempCustomArr.push({
                            chef: ruleState[ci].chefObj || {},
                            equip: ruleState[ci].equipObj || {},
                            recipes: tempRecipes,
                            condiment: {}
                        });
                    } else {
                        tempCustomArr.push(baseCustomArr[ci]);
                    }
                }

                var precisePartialAdds = getPartialRecipeAdds(tempCustomArr, _rule);
                var preciseSlotAdds = precisePartialAdds[slotIdx];

                var g = getRecipeResult(
                    chefObj, ruleState[chefIndex].equipObj,
                    rd, qty, qty, _rule.materials, _rule,
                    _rule.decorationEffect, null, true,
                    tempRecipes,
                    preciseSlotAdds,
                    null
                );
                var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
                var est2 = Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));
                phase2.push({rd: rd, qty: qty, est: est2});
            }
            phase2.sort(function(a, b) { return b.est - a.est; });
        }

        // Phase3: 精确分数
        var candidates = phase2.length > 0 ? phase2 : phase1;
        var phase3Limit = Math.min(topK || 5, candidates.length);
        var results = [];

        for (var i = 0; i < phase3Limit; i++) {
            var rd = candidates[i].rd;
            var qty = candidates[i].qty;

            _simSetRecipe(chefIndex, recipeIndex, rd.recipeId);
            var score = _calcScore();
            results.push({recipeId: rd.recipeId, score: score});

            // 恢复
            ruleState[chefIndex].recipes[recipeIndex] = savedRecipe;
        }

        results.sort(function(a, b) { return b.score - a.score; });
        return results;
    }


    function _getFullRecipeRanking(chefIndex, recipeIndex, topK) {
        var savedSimState = _cloneSimState(_simState);
        var usedRecipeIds = _getUsedRecipeIds(chefIndex, recipeIndex);
        var chefObj = savedSimState[0][chefIndex].chefObj;
        var results = [];

        for (var i = 0; i < _menus.length; i++) {
            var rd = _menus[i];
            if (usedRecipeIds[rd.recipeId]) continue;

            if (chefObj && chefObj.chefId) {
                if (rd.stirfry > 0 && (!chefObj.stirfryVal || chefObj.stirfryVal < rd.stirfry)) continue;
                if (rd.boil > 0 && (!chefObj.boilVal || chefObj.boilVal < rd.boil)) continue;
                if (rd.knife > 0 && (!chefObj.knifeVal || chefObj.knifeVal < rd.knife)) continue;
                if (rd.fry > 0 && (!chefObj.fryVal || chefObj.fryVal < rd.fry)) continue;
                if (rd.bake > 0 && (!chefObj.bakeVal || chefObj.bakeVal < rd.bake)) continue;
                if (rd.steam > 0 && (!chefObj.steamVal || chefObj.steamVal < rd.steam)) continue;
            }

            _simState = _cloneSimState(savedSimState);
            _simSetRecipe(chefIndex, recipeIndex, rd.recipeId);
            var score = _calcScore();
            results.push({ recipeId: rd.recipeId, score: score });
        }

        _simState = _cloneSimState(savedSimState);
        results.sort(function(a, b) { return b.score - a.score; });
        if (topK && results.length > topK) results.length = topK;
        return results;
    }


    function _hasConditionalPartialAdds() {
        for (var ci = 0; ci < _simState[0].length; ci++) {
            var chefObj = _simState[0][ci].chefObj;
            if (!chefObj || !chefObj.chefId) continue;
            if (!chefObj.ultimateSkillEffect) continue;

            var isUltimated = (typeof isAllUltimateMode !== 'undefined' && isAllUltimateMode) ||
                              (_rule.calPartialChefIds && _rule.calPartialChefIds.indexOf(chefObj.chefId) >= 0);
            if (!isUltimated) continue;

            for (var ei = 0; ei < chefObj.ultimateSkillEffect.length; ei++) {
                var eff = chefObj.ultimateSkillEffect[ei];
                if (eff.condition === 'Partial' && eff.conditionType &&
                    eff.conditionType !== 'PerRank' && eff.conditionType !== 'SameSkill' && eff.conditionType !== 'PerSkill') {
                    return true;
                }
            }
        }
        return false;
    }


    function _analyzePriceAuraChefs() {
        var results = [];
        var partialChefIds = _rule.calPartialChefIds || [];

        for (var ci = 0; ci < _rule.chefs.length; ci++) {
            var chef = _rule.chefs[ci];
            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
            if (!_chefMap[chef.chefId]) continue;
            if (!chef.ultimateSkillEffect) continue;

            var isUltimated = (typeof isAllUltimateMode !== 'undefined' && isAllUltimateMode) ||
                              partialChefIds.indexOf(chef.chefId) >= 0;
            if (!isUltimated) continue;

            var auraEffects = [];
            var auraScore = 0;

            for (var ei = 0; ei < chef.ultimateSkillEffect.length; ei++) {
                var eff = chef.ultimateSkillEffect[ei];
                if (eff.condition === 'Partial' && eff.type && eff.type.indexOf('BasicPriceUse') === 0) {
                    auraEffects.push(eff);
                    auraScore += Math.abs(eff.value || 0);
                }
                if (eff.condition === 'Next' && eff.type && eff.type.indexOf('BasicPriceUse') === 0) {
                    auraEffects.push(eff);
                    auraScore += Math.abs(eff.value || 0) * 0.3;
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

        results.sort(function(a, b) { return b.auraScore - a.auraScore; });
        return results;
    }


    function _analyzeRecipeEffects() {
        if (!_rule.RecipeEffect) return [];
        var results = [];
        for (var recipeId in _rule.RecipeEffect) {
            var bonus = _rule.RecipeEffect[recipeId];
            if (bonus > 0) {
                var rd = _recipeMap[recipeId] || _recipeMap[Number(recipeId)];
                if (rd) {
                    results.push({recipeId: rd.recipeId, recipeName: rd.name, bonus: bonus});
                }
            }
        }
        results.sort(function(a, b) { return b.bonus - a.bonus; });
        return results;
    }


    function _analyzeChefTagEffects() {
        if (!_rule.ChefTagEffect) return [];
        var results = [];
        for (var ci = 0; ci < _rule.chefs.length; ci++) {
            var chef = _rule.chefs[ci];
            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
            if (!_chefMap[chef.chefId]) continue;
            if (!chef.tags) continue;

            var totalBonus = 0;
            for (var ti = 0; ti < chef.tags.length; ti++) {
                var tag = chef.tags[ti];
                if (_rule.ChefTagEffect[tag] != null) {
                    totalBonus += _rule.ChefTagEffect[tag];
                }
            }
            if (totalBonus > 0) {
                results.push({chefId: chef.chefId, chefName: chef.name, bonus: totalBonus});
            }
        }
        results.sort(function(a, b) { return b.bonus - a.bonus; });
        return results;
    }


    function _buildSynergyPairs() {
        var pairs = [];
        for (var ci = 0; ci < _rule.chefs.length; ci++) {
            var chef = _rule.chefs[ci];
            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
            if (!_chefMap[chef.chefId]) continue;
            if (!chef.specialSkillEffect) continue;

            for (var mi = 0; mi < _menus.length; mi++) {
                var rd = _menus[mi];
                var synScore = 0;
                for (var ei = 0; ei < chef.specialSkillEffect.length; ei++) {
                    var eff = chef.specialSkillEffect[ei];
                    if (isRecipePriceAddition(eff, rd, _rule)) {
                        synScore += Math.abs(eff.value || 0);
                    }
                    if (isRecipeBasicAddition(eff, rd)) {
                        synScore += Math.abs(eff.value || 0) * 0.5;
                    }
                }
                if (synScore > 0) {
                    pairs.push({
                        chefId: chef.chefId,
                        chefName: chef.name,
                        recipeId: rd.recipeId,
                        recipeName: rd.name,
                        synergyScore: synScore
                    });
                }
            }
        }
        pairs.sort(function(a, b) { return b.synergyScore - a.synergyScore; });
        return pairs.slice(0, 20);
    }


    function _rankChefsForSeed() {
        var results = [];
        var partialChefIds = _rule.calPartialChefIds || [];

        for (var ci = 0; ci < _rule.chefs.length; ci++) {
            var chef = _rule.chefs[ci];
            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
            if (!_chefMap[chef.chefId]) continue;

            var value = chef.rarity * 10; // 基础稀有度分

            // 光环加分
            if (chef.ultimateSkillEffect) {
                var isUltimated = (typeof isAllUltimateMode !== 'undefined' && isAllUltimateMode) ||
                                  partialChefIds.indexOf(chef.chefId) >= 0;
                if (isUltimated) {
                    for (var ei = 0; ei < chef.ultimateSkillEffect.length; ei++) {
                        var eff = chef.ultimateSkillEffect[ei];
                        if (eff.condition === 'Partial' && eff.type && eff.type.indexOf('BasicPriceUse') === 0) {
                            value += Math.abs(eff.value || 0) * 5;
                        }
                    }
                }
            }

            // 标签加分
            if (_rule.ChefTagEffect && chef.tags) {
                for (var ti = 0; ti < chef.tags.length; ti++) {
                    if (_rule.ChefTagEffect[chef.tags[ti]] != null) {
                        value += _rule.ChefTagEffect[chef.tags[ti]] * 100;
                    }
                }
            }

            results.push({ chefId: chef.chefId, chefName: chef.name, value: value });
        }

        results.sort(function(a, b) { return b.value - a.value; });
        return results;
    }


    function _quickChefPreFilter(chefIndex) {
        var currentRecipes = _simState[0][chefIndex].recipes;
        var usedIds = _getUsedChefIds(chefIndex);
        var partialChefIds = _rule.calPartialChefIds || [];
        var results = [];

        for (var i = 0; i < _rule.chefs.length; i++) {
            var chef = _rule.chefs[i];
            if (_cachedConfig.useGot && !chef.got && !isAllUltimateMode) continue;
            if (!_chefMap[chef.chefId]) continue;
            if (usedIds[chef.chefId]) continue;

            var value = chef.rarity * 10;

            // 技能匹配检查：用原始技能值做软评估（不硬过滤，因为加成后技能值会更高）
            var skillBonus = 0;
            var skillPenalty = 0;
            for (var reci = 0; reci < 3; reci++) {
                var rec = currentRecipes[reci];
                if (rec.data) {
                    var skills = ['stirfry', 'boil', 'knife', 'fry', 'bake', 'steam'];
                    for (var si = 0; si < skills.length; si++) {
                        var sk = skills[si];
                        var required = rec.data[sk] || 0;
                        var has = chef[sk] || 0;
                        if (required > 0) {
                            if (has >= required) {
                                skillBonus += has - required;
                            } else {
                                // 原始值不够，但加成后可能够，给惩罚而非排除
                                skillPenalty += (required - has) * 2;
                            }
                        }
                    }
                }
            }
            value += Math.min(skillBonus, 50);
            value -= skillPenalty;

            // 光环加分
            if (chef.ultimateSkillEffect) {
                var isUltimated = (typeof isAllUltimateMode !== 'undefined' && isAllUltimateMode) ||
                                  partialChefIds.indexOf(chef.chefId) >= 0;
                if (isUltimated) {
                    for (var ei = 0; ei < chef.ultimateSkillEffect.length; ei++) {
                        var eff = chef.ultimateSkillEffect[ei];
                        if (eff.condition === 'Partial' && eff.type && eff.type.indexOf('BasicPriceUse') === 0) {
                            value += Math.abs(eff.value || 0) * 5;
                        }
                    }
                }
            }

            // 标签加分
            if (_rule.ChefTagEffect && chef.tags) {
                for (var ti = 0; ti < chef.tags.length; ti++) {
                    if (_rule.ChefTagEffect[chef.tags[ti]] != null) {
                        value += _rule.ChefTagEffect[chef.tags[ti]] * 100;
                    }
                }
            }

            results.push({ chefId: chef.chefId, value: value });
        }

        results.sort(function(a, b) { return b.value - a.value; });
        var topN = Math.min(50, results.length);
        var filtered = [];
        for (var k = 0; k < topN; k++) {
            filtered.push(results[k].chefId);
        }
        return filtered;
    }


    function _generateChefTripleSeeds(rankedChefs, onDone) {
        var seeds = [];
        var topN = Math.min((_simpleMode ? 10 : 10), rankedChefs.length);

        // 预生成所有组合
        var combos = [];
        for (var i = 0; i < topN; i++) {
            for (var j = i + 1; j < topN; j++) {
                for (var k = j + 1; k < topN; k++) {
                    combos.push([i, j, k]);
                }
            }
        }

        var comboIdx = 0;
        var batchSize = 5;

        function _processBatch() {
            var batchEnd = Math.min(comboIdx + batchSize, combos.length);

            for (; comboIdx < batchEnd; comboIdx++) {
                var ci = combos[comboIdx][0], cj = combos[comboIdx][1], ck = combos[comboIdx][2];
                var trio = [rankedChefs[ci], rankedChefs[cj], rankedChefs[ck]];

                // 先试正序和逆序2种排列（快速筛选）（唯一三元组时只用1种）
                var quickPerms = _getChefPermutations(true);

                var bestPermScore = 0;
                var bestPermState = null;
                var bestPermSource = '';

                for (var pi = 0; pi < quickPerms.length; pi++) {
                    _initSimState();
                    var perm = quickPerms[pi];
                    for (var pos = 0; pos < 3; pos++) {
                        _simSetChef(pos, trio[perm[pos]].chefId);
                    }
                    for (var pos = 0; pos < 3; pos++) {
                        for (var reci = 0; reci < 3; reci++) {
                            var rk = _fastGetRecipeRanking(pos, reci, 1, true);
                            if (rk.length > 0) _simSetRecipe(pos, reci, rk[0].recipeId);
                        }
                    }
                    var score = _calcScore();
                    if (score > bestPermScore) {
                        bestPermScore = score;
                        bestPermState = _cloneSimState(_simState);
                        bestPermSource = '三元组-' + trio[perm[0]].chefName + '+' + trio[perm[1]].chefName + '+' + trio[perm[2]].chefName;
                    }
                }

                if (bestPermState) {
                    seeds.push({ state: bestPermState, score: bestPermScore, source: bestPermSource });
                }
            }

            if (comboIdx < combos.length) {
                setTimeout(_processBatch, 2);
            } else {
                // 第二轮：对top20种子，用全6种排列精搜
                seeds.sort(function(a, b) { return b.score - a.score; });
                var topSeeds = seeds.slice(0, Math.min(_simpleMode ? 12 : 20, seeds.length));
                var bestSeedScore = topSeeds.length > 0 ? topSeeds[0].score : 0;
                var threshold = bestSeedScore * 0.85;

                var expandSeeds = [];
                for (var si = 0; si < topSeeds.length; si++) {
                    if (topSeeds[si].score < threshold) break;
                    expandSeeds.push(topSeeds[si]);
                }

                // 对高分种子做全排列精搜
                var expandIdx = 0;
                function _expandBatch() {
                    var eBatchEnd = Math.min(expandIdx + 3, expandSeeds.length);
                    for (; expandIdx < eBatchEnd; expandIdx++) {
                        var seedState = expandSeeds[expandIdx].state;
                        // 提取厨师ID
                        var chefIds = [];
                        for (var pos = 0; pos < 3; pos++) {
                            chefIds.push(seedState[0][pos].chefId);
                        }
                        // 找对应的trio对象
                        var trioObjs = [];
                        for (var pos = 0; pos < 3; pos++) {
                            for (var ri = 0; ri < rankedChefs.length; ri++) {
                                if (rankedChefs[ri].chefId === chefIds[pos]) {
                                    trioObjs.push(rankedChefs[ri]);
                                    break;
                                }
                            }
                        }
                        if (trioObjs.length !== 3) continue;

                        var allPerms = _getChefPermutations(false);
                        for (var pi = 0; pi < allPerms.length; pi++) {
                            _initSimState();
                            var perm = allPerms[pi];
                            for (var pos = 0; pos < 3; pos++) {
                                _simSetChef(pos, trioObjs[perm[pos]].chefId);
                            }
                            for (var pos = 0; pos < 3; pos++) {
                                for (var reci = 0; reci < 3; reci++) {
                                    var rk = _fastGetRecipeRanking(pos, reci, 1, true);
                                    if (rk.length > 0) _simSetRecipe(pos, reci, rk[0].recipeId);
                                }
                            }
                            _quickRefineFast(true);
                            var score = _calcScore();
                            if (score > expandSeeds[expandIdx].score) {
                                expandSeeds[expandIdx].score = score;
                                expandSeeds[expandIdx].state = _cloneSimState(_simState);
                                expandSeeds[expandIdx].source = '三元组-' + trioObjs[perm[0]].chefName + '+' + trioObjs[perm[1]].chefName + '+' + trioObjs[perm[2]].chefName;
                            }
                        }
                    }

                    if (expandIdx < expandSeeds.length) {
                        setTimeout(_expandBatch, 2);
                    } else {
                        // 合并结果
                        var allSeeds = seeds.concat(expandSeeds);
                        allSeeds.sort(function(a, b) { return b.score - a.score; });
                        var deduped = [];
                        var seen = {};
                        for (var i = 0; i < allSeeds.length; i++) {
                            var sig = _getStateRecipeSignature(allSeeds[i].state, false);
                            if (!seen[sig]) {
                                seen[sig] = true;
                                deduped.push(allSeeds[i]);
                                if (deduped.length >= (_simpleMode ? 12 : 20)) break;
                            }
                        }
                        if (typeof onDone === 'function') onDone(deduped);
                    }
                }

                if (expandSeeds.length > 0) {
                    setTimeout(_expandBatch, 2);
                } else {
                    // 没有需要扩展的种子
                    var deduped = [];
                    var seen = {};
                    for (var i = 0; i < seeds.length; i++) {
                        var sig = _getStateRecipeSignature(seeds[i].state, false);
                        if (!seen[sig]) {
                            seen[sig] = true;
                            deduped.push(seeds[i]);
                            if (deduped.length >= (_simpleMode ? 12 : 20)) break;
                        }
                    }
                    if (typeof onDone === 'function') onDone(deduped);
                }
            }
        }

        _processBatch();
    }


    function _estimateMaterialConflictPenalty(recipeData, quantity, chefIndex, chefObj) {
        if (!_materialsAll || !_rule.MaterialsLimit || !recipeData || quantity <= 0) {
            return {penalty: 0, conflictInfo: ''};
        }

        // 计算该菜谱每份消耗的食材
        var myPerUnit = {};
        for (var m = 0; m < recipeData.materials.length; m++) {
            var mat = recipeData.materials[m];
            myPerUnit[mat.material] = calMaterialReduce(chefObj, mat.material, mat.quantity);
        }

        // 计算其他位置+同位置其他槽位已分配菜谱消耗的食材
        var otherUsage = {};
        for (var ci = 0; ci < _simState[0].length; ci++) {
            for (var ri = 0; ri < 3; ri++) {
                // 跳过自己这个槽位（但不跳过同位置的其他槽位）
                if (ci === chefIndex) {
                    // 同位置其他槽位也要计入
                    var isMySlot = false;
                    var curSlotRec = _simState[0][ci].recipes[ri];
                    if (curSlotRec.data && curSlotRec.data.recipeId === recipeData.recipeId) {
                        isMySlot = true;
                    }
                    if (isMySlot) continue;
                }
                var rec = _simState[0][ci].recipes[ri];
                if (!rec.data || rec.quantity <= 0) continue;
                var recChef = _simState[0][ci].chefObj;
                for (var m2 = 0; m2 < rec.data.materials.length; m2++) {
                    var mat2 = rec.data.materials[m2];
                    var perQty2 = calMaterialReduce(recChef, mat2.material, mat2.quantity);
                    var matId = mat2.material;
                    if (!otherUsage[matId]) otherUsage[matId] = 0;
                    otherUsage[matId] += perQty2 * rec.quantity;
                }
            }
        }

        // 机会成本计算：比较"无冲突理论最大份数"和"有冲突实际份数"
        // 无冲突理论最大份数 = min(各食材: floor(全量/每份消耗))
        // 有冲突实际份数 = min(各食材: floor((全量-他人消耗)/每份消耗))
        var maxQtyNoConflict = quantity; // 至少是当前份数
        var maxQtyWithConflict = 999;
        var hasConflict = false;
        var conflicts = [];

        for (var matId2 in myPerUnit) {
            var perUnit = myPerUnit[matId2];
            if (perUnit <= 0) continue;
            var available = _materialsAll[matId2] || 0;
            var otherUse = otherUsage[matId2] || 0;

            // 无冲突时的理论最大份数（只有我用这个食材）
            var noConflictMax = Math.floor(available / perUnit);
            // 有冲突时的实际最大份数
            var withConflictMax = Math.floor(Math.max(0, available - otherUse) / perUnit);

            maxQtyWithConflict = Math.min(maxQtyWithConflict, withConflictMax);

            if (otherUse > 0 && withConflictMax < noConflictMax) {
                hasConflict = true;
                // 记录受限最严重的食材
                var lostFromMat = noConflictMax - withConflictMax;
                if (lostFromMat > 0) {
                    conflicts.push('食材' + matId2 + '争' + otherUse + '限' + withConflictMax);
                }
            }
        }

        if (!hasConflict || maxQtyWithConflict >= quantity) {
            // 没有冲突，或冲突不影响当前份数
            return {penalty: 0, conflictInfo: ''};
        }

        // 计算份数损失带来的分数惩罚
        // 用 getRecipeResult 精确计算满份和受限份的分差
        var lostQty = quantity - maxQtyWithConflict;
        if (lostQty <= 0) return {penalty: 0, conflictInfo: ''};

        var curSlot = _simState[0][chefIndex];
        var perUnitScore = (recipeData.price || 100) * 3; // 默认粗估

        // 尝试精确估算每份分数
        var gFull = getRecipeResult(
            chefObj, curSlot.equipObj || {},
            recipeData, quantity, quantity, _rule.materials, _rule,
            _rule.decorationEffect, null, true,
            curSlot.recipes, null, null
        );
        var actAddF = (gFull.data && gFull.data.activityAddition) ? gFull.data.activityAddition : 0;
        var fullScore = Math.ceil(+(gFull.totalScore * (1 + actAddF / 100)).toFixed(2));

        if (maxQtyWithConflict > 0) {
            var gReduced = getRecipeResult(
                chefObj, curSlot.equipObj || {},
                recipeData, maxQtyWithConflict, maxQtyWithConflict, _rule.materials, _rule,
                _rule.decorationEffect, null, true,
                curSlot.recipes, null, null
            );
            var actAddR = (gReduced.data && gReduced.data.activityAddition) ? gReduced.data.activityAddition : 0;
            var reducedScore = Math.ceil(+(gReduced.totalScore * (1 + actAddR / 100)).toFixed(2));
            var totalPenalty = fullScore - reducedScore;
            if (totalPenalty < 0) totalPenalty = 0;
            return {penalty: totalPenalty, conflictInfo: conflicts.join(',')};
        } else {
            // 完全无法做，惩罚为全部分数
            return {penalty: fullScore, conflictInfo: conflicts.join(',')};
        }
    }


    function _greedyFillPosition(chefIndex) {
        if (!_simState[0][chefIndex].chefId) {
            var chefRk = _fastGetChefRanking(chefIndex, true);
            for (var j = 0; j < chefRk.length; j++) {
                if (!chefRk[j].used && chefRk[j].skillOk !== false) {
                    _simSetChef(chefIndex, chefRk[j].chefId);
                    break;
                }
            }
        }
        for (var reci = 0; reci < 3; reci++) {
            if (_simState[0][chefIndex].recipes[reci].data) continue;
            var recipeRk = _fastGetRecipeRanking(chefIndex, reci, 1, true);
            if (recipeRk.length > 0) {
                _simSetRecipe(chefIndex, reci, recipeRk[0].recipeId);
            }
        }
    }


    function _greedyFillAll() {
        for (var ci = 0; ci < 3; ci++) {
            _greedyFillPosition(ci);
        }
    }


    function _quickRefineFast(lightMode) {
        var maxIter = lightMode === true ? 1 : (typeof lightMode === 'number' ? lightMode : CONFIG.refineIter);
        var includeChefs = lightMode !== true;

        for (var iter = 0; iter < maxIter; iter++) {
            var improved = false;
            var scoreBefore = _calcScore();

            // 菜谱替换
            for (var ci = 0; ci < 3; ci++) {
                for (var reci = 0; reci < 3; reci++) {
                    var curRecId = _simState[0][ci].recipes[reci].data ?
                        _simState[0][ci].recipes[reci].data.recipeId : null;
                    var rk = _fastGetRecipeRanking(ci, reci, 3, true);
                    for (var ki = 0; ki < rk.length; ki++) {
                        if (rk[ki].recipeId === curRecId) continue;
                        var savedRec = _simState[0][ci].recipes[reci];
                        _simSetRecipe(ci, reci, rk[ki].recipeId);
                        var newScore = _calcScore();
                        if (newScore > scoreBefore) {
                            scoreBefore = newScore;
                            improved = true;
                        } else {
                            _simState[0][ci].recipes[reci] = savedRec;
                        }
                    }
                }
            }

            // 厨师替换
            if (includeChefs) {
                for (var ci = 0; ci < 3; ci++) {
                    var curChefId = _simState[0][ci].chefId;
                    var chefRk = _fastGetChefRanking(ci, true);
                    for (var j = 0; j < Math.min(5, chefRk.length); j++) {
                        if (chefRk[j].chefId === curChefId) continue;
                        if (chefRk[j].used || chefRk[j].skillOk === false) continue;

                        var savedState = _cloneSimState(_simState);
                        _simSetChef(ci, chefRk[j].chefId);
                        // 重选菜谱
                        for (var reci = 0; reci < 3; reci++) {
                            var rk = _fastGetRecipeRanking(ci, reci, 1, true);
                            if (rk.length > 0) _simSetRecipe(ci, reci, rk[0].recipeId);
                        }
                        var newScore = _calcScore();
                        if (newScore > scoreBefore) {
                            scoreBefore = newScore;
                            improved = true;
                        } else {
                            _simState = savedState;
                        }
                    }
                }
            }

            if (!improved) break;
        }
    }


    function _climbChefs() {
        var improved = false;
        for (var ci = 0; ci < 3; ci++) {
            var curChefId = _simState[0][ci].chefId;

            // 预过滤：轻量级筛选top50厨师
            var preFiltered = _quickChefPreFilter(ci);

            // Phase 1: 方案A（保留菜谱换厨师）对所有预过滤厨师
            var planAResults = [];
            for (var fi = 0; fi < preFiltered.length; fi++) {
                var chefId = preFiltered[fi];
                if (chefId === curChefId) continue;

                var chef = null;
                for (var k = 0; k < _rule.chefs.length; k++) {
                    if (_rule.chefs[k].chefId === chefId) { chef = _rule.chefs[k]; break; }
                }
                if (!chef) continue;

                var savedState = _cloneSimState(_simState);
                _simSetChef(ci, chef.chefId);

                var chefObj = _simState[0][ci].chefObj;
                var skillFail = false;
                for (var reci = 0; reci < 3; reci++) {
                    var rec = _simState[0][ci].recipes[reci];
                    if (rec.data) {
                        if (rec.data.stirfry > 0 && (!chefObj.stirfryVal || chefObj.stirfryVal < rec.data.stirfry)) skillFail = true;
                        if (rec.data.boil > 0 && (!chefObj.boilVal || chefObj.boilVal < rec.data.boil)) skillFail = true;
                        if (rec.data.knife > 0 && (!chefObj.knifeVal || chefObj.knifeVal < rec.data.knife)) skillFail = true;
                        if (rec.data.fry > 0 && (!chefObj.fryVal || chefObj.fryVal < rec.data.fry)) skillFail = true;
                        if (rec.data.bake > 0 && (!chefObj.bakeVal || chefObj.bakeVal < rec.data.bake)) skillFail = true;
                        if (rec.data.steam > 0 && (!chefObj.steamVal || chefObj.steamVal < rec.data.steam)) skillFail = true;
                    }
                    if (skillFail) break;
                }

                var scoreA = -1;
                if (!skillFail) {
                    for (var reci = 0; reci < 3; reci++) {
                        var rec = _simState[0][ci].recipes[reci];
                        if (rec.data) {
                            _simSetRecipe(ci, reci, rec.data.recipeId);
                        }
                    }
                    scoreA = _calcScore();
                }

                _simState = savedState;
                planAResults.push({ chefId: chefId, chef: chef, scoreA: scoreA });
            }

            // 按scoreA排序，取top10做方案B
            planAResults.sort(function(a, b) { return b.scoreA - a.scoreA; });
            var top10 = Math.min(10, planAResults.length);

            for (var ti = 0; ti < top10; ti++) {
                var item = planAResults[ti];
                var scoreA = item.scoreA;

                // 方案B：换厨师+重选菜谱
                var savedState = _cloneSimState(_simState);
                _simSetChef(ci, item.chefId);
                for (var reci = 0; reci < 3; reci++) {
                    _simState[0][ci].recipes[reci] = {data: null, quantity: 0, max: 0};
                }
                for (var reci = 0; reci < 3; reci++) {
                    var rk = _fastGetRecipeRanking(ci, reci, 1, true);
                    if (rk.length > 0) _simSetRecipe(ci, reci, rk[0].recipeId);
                }
                var scoreB = _calcScore();

                var bestAlt = Math.max(scoreA, scoreB);
                if (bestAlt > _bestScore) {
                    if (scoreA >= scoreB && scoreA > 0) {
                        _simState = _cloneSimState(savedState);
                        _simSetChef(ci, item.chefId);
                        for (var reci = 0; reci < 3; reci++) {
                            var rec = _simState[0][ci].recipes[reci];
                            if (rec.data) {
                                _simSetRecipe(ci, reci, rec.data.recipeId);
                            }
                        }
                    }
                    _bestScore = bestAlt;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    _logCurrentCombo('厨师替换 位置' + ci + ' ' + item.chef.name, bestAlt);
                    
                    // 添加到前10名
                    _tryInsertTop10Feasible(_bestScore, _bestSimState, "厨师替换");
                } else {
                    _simState = savedState;
                }
            }
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbDualChefs() {
        var improved = false;
        var pairs = [[0, 1], [0, 2], [1, 2]];

        for (var pi = 0; pi < pairs.length; pi++) {
            var ci1 = pairs[pi][0], ci2 = pairs[pi][1];
            var curId1 = _simState[0][ci1].chefId;
            var curId2 = _simState[0][ci2].chefId;
            var ci3 = 3 - ci1 - ci2; // 第三个位置
            var curId3 = _simState[0][ci3].chefId;

            // 对两个位置分别取top8候选厨师
            var preFilter1 = _quickChefPreFilter(ci1);
            var preFilter2 = _quickChefPreFilter(ci2);
            var cands1 = preFilter1.slice(0, 8);
            var cands2 = preFilter2.slice(0, 8);

            for (var a = 0; a < cands1.length; a++) {
                if (cands1[a] === curId1 || cands1[a] === curId3) continue;
                for (var b = 0; b < cands2.length; b++) {
                    if (cands2[b] === curId2 || cands2[b] === curId3) continue;
                    if (cands1[a] === cands2[b]) continue; // 不能用同一个厨师

                    var savedState = _cloneSimState(_simState);
                    _simSetChef(ci1, cands1[a]);
                    _simSetChef(ci2, cands2[b]);
                    // 两个位置都重选菜谱
                    for (var reci = 0; reci < 3; reci++) {
                        _simState[0][ci1].recipes[reci] = {data: null, quantity: 0, max: 0};
                        _simState[0][ci2].recipes[reci] = {data: null, quantity: 0, max: 0};
                    }
                    for (var reci = 0; reci < 3; reci++) {
                        var rk1 = _fastGetRecipeRanking(ci1, reci, 1, true);
                        if (rk1.length > 0) _simSetRecipe(ci1, reci, rk1[0].recipeId);
                        var rk2 = _fastGetRecipeRanking(ci2, reci, 1, true);
                        if (rk2.length > 0) _simSetRecipe(ci2, reci, rk2[0].recipeId);
                    }
                    var newScore = _calcScore();
                    if (newScore > _bestScore) {
                        _bestScore = newScore;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        _logCurrentCombo('双厨师替换 位置' + ci1 + '+' + ci2, newScore);
                        
                        // 添加到前10名
                        _tryInsertTop10Feasible(_bestScore, _bestSimState, "双厨师替换");
                    } else {
                        _simState = savedState;
                    }
                }
            }
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbRecipes() {
        var improved = false;
        for (var ci = 0; ci < 3; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var curRecId = _simState[0][ci].recipes[reci].data ?
                    _simState[0][ci].recipes[reci].data.recipeId : null;
                var rk = _fastGetRecipeRanking(ci, reci, CONFIG.recipeTopN, true);

                for (var ki = 0; ki < rk.length; ki++) {
                    if (rk[ki].recipeId === curRecId) continue;

                    var savedRec = _simState[0][ci].recipes[reci];
                    _simSetRecipe(ci, reci, rk[ki].recipeId);
                    var newScore = _calcScore();
                    if (newScore > _bestScore) {
                        _bestScore = newScore;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        _logCurrentCombo('菜谱替换 位置' + ci + '菜' + reci, newScore);
                        
                        // 添加到前10名
                        _tryInsertTop10Feasible(_bestScore, _bestSimState, "菜谱替换");
                    } else {
                        _simState[0][ci].recipes[reci] = savedRec;
                    }
                }
            }
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbChefSwap() {
        var improved = false;
        for (var ci = 0; ci < 3; ci++) {
            for (var cj = ci + 1; cj < 3; cj++) {
                var savedState = _cloneSimState(_simState);

                // 交换厨师
                var tmpChefId = _simState[0][ci].chefId;
                var tmpChefObj = _simState[0][ci].chefObj;
                var tmpEquipObj = _simState[0][ci].equipObj;
                _simState[0][ci].chefId = _simState[0][cj].chefId;
                _simState[0][ci].chefObj = _simState[0][cj].chefObj;
                _simState[0][ci].equipObj = _simState[0][cj].equipObj;
                _simState[0][cj].chefId = tmpChefId;
                _simState[0][cj].chefObj = tmpChefObj;
                _simState[0][cj].equipObj = tmpEquipObj;
                _applyChefData();

                // 交换厨师后重算份数（MaterialReduce技能影响食材消耗）
                for (var pos = 0; pos < 3; pos++) {
                    if (pos !== ci && pos !== cj) continue;
                    for (var reci = 0; reci < 3; reci++) {
                        var rec = _simState[0][pos].recipes[reci];
                        if (rec.data) {
                            _simSetRecipe(pos, reci, rec.data.recipeId);
                        }
                    }
                }

                var newScore = _calcScore();
                if (newScore > _bestScore) {
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    _logCurrentCombo('厨师交换 位置' + ci + '↔' + cj, newScore);
                    
                    // 添加到前10名
                    _tryInsertTop10Feasible(_bestScore, _bestSimState, "厨师交换");
                } else {
                    _simState = savedState;
                }
            }
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbRecipeSwap() {
        var improved = false;
        var allSlots = [];
        for (var ci = 0; ci < 3; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                if (_simState[0][ci].recipes[reci].data) {
                    allSlots.push({ci: ci, reci: reci});
                }
            }
        }

        for (var i = 0; i < allSlots.length; i++) {
            for (var j = i + 1; j < allSlots.length; j++) {
                var a = allSlots[i], b = allSlots[j];
                if (a.ci === b.ci) continue; // 同厨师内交换意义不大

                var savedState = _cloneSimState(_simState);
                var tmpRec = _simState[0][a.ci].recipes[a.reci];
                _simState[0][a.ci].recipes[a.reci] = _simState[0][b.ci].recipes[b.reci];
                _simState[0][b.ci].recipes[b.reci] = tmpRec;

                // 交换后重算份数（不同厨师的MaterialReduce影响食材消耗）
                var recA = _simState[0][a.ci].recipes[a.reci];
                var recB = _simState[0][b.ci].recipes[b.reci];
                if (recA.data) _simSetRecipe(a.ci, a.reci, recA.data.recipeId);
                if (recB.data) _simSetRecipe(b.ci, b.reci, recB.data.recipeId);

                var newScore = _calcScore();
                if (newScore > _bestScore) {
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    _logCurrentCombo('菜谱交换 ' + a.ci + ':' + a.reci + '↔' + b.ci + ':' + b.reci, newScore);
                    
                    // 添加到前10名
                    _tryInsertTop10Feasible(_bestScore, _bestSimState, "菜谱交换");
                } else {
                    _simState = savedState;
                }
            }
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbJointChefRecipe() {
        var improved = false;
        for (var ci = 0; ci < 3; ci++) {
            var curChefId = _simState[0][ci].chefId;
            var usedIds = _getUsedChefIds(ci);
            var chefRk = _fastGetChefRanking(ci, true);

            for (var j = 0; j < Math.min(10, chefRk.length); j++) {
                if (chefRk[j].chefId === curChefId) continue;
                if (chefRk[j].used || chefRk[j].skillOk === false) continue;

                var savedState = _cloneSimState(_simState);
                _simSetChef(ci, chefRk[j].chefId);

                // 清空菜谱重选
                for (var reci = 0; reci < 3; reci++) {
                    _simState[0][ci].recipes[reci] = {data: null, quantity: 0, max: 0};
                }
                for (var reci = 0; reci < 3; reci++) {
                    var rk = _fastGetRecipeRanking(ci, reci, 1, true);
                    if (rk.length > 0) _simSetRecipe(ci, reci, rk[0].recipeId);
                }

                var newScore = _calcScore();
                if (newScore > _bestScore) {
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    _logCurrentCombo('联合替换 位置' + ci + ' ' + _getChefNameById(chefRk[j].chefId), newScore);
                    
                    // 添加到前10名
                    _tryInsertTop10Feasible(_bestScore, _bestSimState, "联合替换");
                } else {
                    _simState = savedState;
                }
            }
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbMultiPositionRebuild() {
        var improved = false;

        // 对每对位置组合 (0,1), (0,2), (1,2)
        for (var ci = 0; ci < 3; ci++) {
            for (var cj = ci + 1; cj < 3; cj++) {
                if (!_simState[0][ci].chefId || !_simState[0][cj].chefId) continue;

                var savedState = _cloneSimState(_simState);

                // 清空两个位置的所有菜谱
                for (var reci = 0; reci < 3; reci++) {
                    _simState[0][ci].recipes[reci] = {data: null, quantity: 0, max: 0};
                    _simState[0][cj].recipes[reci] = {data: null, quantity: 0, max: 0};
                }

                // 交替贪心填充：先ci的菜1，再cj的菜1，ci的菜2...
                for (var reci = 0; reci < 3; reci++) {
                    var rk1 = _fastGetRecipeRanking(ci, reci, 1, true);
                    if (rk1.length > 0) _simSetRecipe(ci, reci, rk1[0].recipeId);
                    var rk2 = _fastGetRecipeRanking(cj, reci, 1, true);
                    if (rk2.length > 0) _simSetRecipe(cj, reci, rk2[0].recipeId);
                }

                var newScore = _calcScore();
                if (newScore > _bestScore) {
                    console.log('[厨神大赛] 双位置重建提升: 位置' + ci + '+' + cj + ' 分数=' + newScore);
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    
                    // 添加到前10名
                    _tryInsertTop10Feasible(_bestScore, _bestSimState, "双位置重建");
                } else {
                    _simState = savedState;
                }

                // 也尝试反向填充顺序（先cj再ci）
                _simState = _cloneSimState(savedState);
                for (var reci = 0; reci < 3; reci++) {
                    _simState[0][ci].recipes[reci] = {data: null, quantity: 0, max: 0};
                    _simState[0][cj].recipes[reci] = {data: null, quantity: 0, max: 0};
                }
                for (var reci = 0; reci < 3; reci++) {
                    var rk2b = _fastGetRecipeRanking(cj, reci, 1, true);
                    if (rk2b.length > 0) _simSetRecipe(cj, reci, rk2b[0].recipeId);
                    var rk1b = _fastGetRecipeRanking(ci, reci, 1, true);
                    if (rk1b.length > 0) _simSetRecipe(ci, reci, rk1b[0].recipeId);
                }

                var newScore2 = _calcScore();
                if (newScore2 > _bestScore) {
                    console.log('[厨神大赛] 双位置重建(反向)提升: 位置' + cj + '+' + ci + ' 分数=' + newScore2);
                    _bestScore = newScore2;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    
                    // 添加到前10名
                    _tryInsertTop10Feasible(_bestScore, _bestSimState, "双位置重建(反向)");
                } else {
                    _simState = _cloneSimState(_bestSimState);
                }
            }
        }

        // 三位置全重建
        if (_simState[0][0].chefId && _simState[0][1].chefId && _simState[0][2].chefId) {
            var perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
            for (var pi = 0; pi < perms.length; pi++) {
                var perm = perms[pi];
                var savedAll = _cloneSimState(_simState);

                // 清空所有菜谱
                for (var ci3 = 0; ci3 < 3; ci3++) {
                    for (var reci = 0; reci < 3; reci++) {
                        _simState[0][ci3].recipes[reci] = {data: null, quantity: 0, max: 0};
                    }
                }

                // 按排列顺序贪心填充
                for (var step = 0; step < 3; step++) {
                    var pos = perm[step];
                    for (var reci = 0; reci < 3; reci++) {
                        var rk = _fastGetRecipeRanking(pos, reci, 1, true);
                        if (rk.length > 0) _simSetRecipe(pos, reci, rk[0].recipeId);
                    }
                }

                var newScore3 = _calcScore();
                if (newScore3 > _bestScore) {
                    console.log('[厨神大赛] 三位置全重建提升: 顺序=' + perm.join('→') + ' 分数=' + newScore3);
                    _bestScore = newScore3;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    
                    // 添加到前10名
                    _tryInsertTop10Feasible(_bestScore, _bestSimState, "三位置全重建");
                } else {
                    _simState = _cloneSimState(savedAll);
                }
            }
        }

        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbRecipeReselect() {
        var improved = false;
        for (var ci = 0; ci < 3; ci++) {
            if (!_simState[0][ci].chefId) continue;

            var savedState = _cloneSimState(_simState);

            // 清空该厨师的所有菜谱
            for (var reci = 0; reci < 3; reci++) {
                _simState[0][ci].recipes[reci] = {data: null, quantity: 0, max: 0};
            }

            // 方案1：原始贪心重选
            for (var reci = 0; reci < 3; reci++) {
                var rk = _fastGetRecipeRanking(ci, reci, 3, true);
                if (rk.length > 0) _simSetRecipe(ci, reci, rk[0].recipeId);
            }

            var bestState = _cloneSimState(_simState);
            var bestScore = _calcScore();

            // 方案2：中等强度 beam 搜索，只在更容易涨分的位置1/2启用
            var beamOrders = [[1, 0, 2], [2, 1, 0]];
            var beamWidth = 4;
            var slotCandidateTopK = 3;

            function _getPositionSignature(state, chefIndex) {
                var ids = [];
                for (var sri = 0; sri < 3; sri++) {
                    var srec = state[0][chefIndex].recipes[sri];
                    ids.push(srec.data ? srec.data.recipeId : 0);
                }
                return ids.join('-');
            }

            if (ci !== 0) {
                for (var oi = 0; oi < beamOrders.length; oi++) {
                    var emptyState = _cloneSimState(savedState);
                    for (var eri = 0; eri < 3; eri++) {
                        emptyState[0][ci].recipes[eri] = {data: null, quantity: 0, max: 0};
                    }

                    var beams = [{ state: emptyState, score: 0 }];
                    var order = beamOrders[oi];

                    for (var step = 0; step < order.length; step++) {
                        var slotIndex = order[step];
                        var nextBeams = [];

                        for (var bi = 0; bi < beams.length; bi++) {
                            _simState = _cloneSimState(beams[bi].state);
                            var candidates;
                            if (step === 0) {
                                candidates = _getFullRecipeRanking(ci, slotIndex, 5);
                            } else if (step === 1) {
                                candidates = _getFullRecipeRanking(ci, slotIndex, 4);
                            } else {
                                candidates = _fastGetRecipeRanking(ci, slotIndex, slotCandidateTopK, true);
                            }
                            if (candidates.length === 0) continue;

                            for (var cki = 0; cki < candidates.length; cki++) {
                                _simState = _cloneSimState(beams[bi].state);
                                _simSetRecipe(ci, slotIndex, candidates[cki].recipeId);
                                var score = _calcScore();
                                nextBeams.push({
                                    state: _cloneSimState(_simState),
                                    score: score
                                });
                            }
                        }

                        if (nextBeams.length === 0) {
                            beams = [];
                            break;
                        }

                        nextBeams.sort(function(a, b) { return b.score - a.score; });
                        var dedupedBeams = [];
                        var seenBeam = {};
                        for (var nbi = 0; nbi < nextBeams.length; nbi++) {
                            var sig = _getPositionSignature(nextBeams[nbi].state, ci);
                            if (seenBeam[sig]) continue;
                            seenBeam[sig] = true;
                            dedupedBeams.push(nextBeams[nbi]);
                            if (dedupedBeams.length >= beamWidth) break;
                        }
                        beams = dedupedBeams;
                    }

                    for (var fi = 0; fi < beams.length; fi++) {
                        if (beams[fi].score > bestScore) {
                            bestScore = beams[fi].score;
                            bestState = _cloneSimState(beams[fi].state);
                        }
                    }
                }
            }

            _simState = _cloneSimState(bestState);
            if (bestScore > _bestScore) {
                console.log('[厨神大赛] 菜谱全重选提升: 位置' + ci + ' ' + _getChefNameById(_simState[0][ci].chefId) + ' 分数=' + bestScore);
                _bestScore = bestScore;
                _bestSimState = _cloneSimState(_simState);
                improved = true;
                _logCurrentCombo('菜谱全重选 位置' + ci, bestScore);

                _tryInsertTop10Feasible(_bestScore, _bestSimState, "菜谱全重选");
            } else {
                _simState = savedState;
            }
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbInjectRecipeEffectLite() {
        if (!_rule.RecipeEffect) return false;
        var improved = false;
        var reRecipes = [];

        for (var recipeId in _rule.RecipeEffect) {
            var bonus = _rule.RecipeEffect[recipeId];
            if (!(bonus > 0)) continue;
            var rd = _recipeMap[recipeId] || _recipeMap[Number(recipeId)];
            if (rd) reRecipes.push({ rd: rd, bonus: bonus });
        }
        if (reRecipes.length === 0) return false;
        reRecipes.sort(function(a, b) { return b.bonus - a.bonus; });

        var usedREIds = {};
        for (var ci = 0; ci < 3; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = _simState[0][ci].recipes[reci];
                if (!rec.data) continue;
                var reStr = rec.data.recipeId.toString();
                var reNum = Number(rec.data.recipeId);
                if (_rule.RecipeEffect[reStr] != null || _rule.RecipeEffect[reNum] != null) {
                    usedREIds[rec.data.recipeId] = true;
                }
            }
        }

        var tryCount = 0;
        var maxRecipes = 6;
        for (var ri = 0; ri < Math.min(maxRecipes, reRecipes.length); ri++) {
            var reRd = reRecipes[ri].rd;
            if (usedREIds[reRd.recipeId]) continue;

            for (var ci2 = 0; ci2 < 3; ci2++) {
                var chefObj = _simState[0][ci2].chefObj;
                if (!chefObj) continue;
                if (!_isRecipeSkillFeasible(chefObj, reRd)) continue;

                for (var reci2 = 0; reci2 < 3; reci2++) {
                    tryCount++;
                    var savedState = _cloneSimState(_simState);
                    _simSetRecipe(ci2, reci2, reRd.recipeId);
                    if (!_simState[0][ci2].recipes[reci2].data || _simState[0][ci2].recipes[reci2].data.recipeId !== reRd.recipeId) {
                        _simState = savedState;
                        continue;
                    }

                    for (var otherReci = 0; otherReci < 3; otherReci++) {
                        if (otherReci === reci2) continue;
                        _simState[0][ci2].recipes[otherReci] = {data: null, quantity: 0, max: 0};
                    }
                    for (var otherReci2 = 0; otherReci2 < 3; otherReci2++) {
                        if (otherReci2 === reci2) continue;
                        var rk = _fastGetRecipeRanking(ci2, otherReci2, 1, true);
                        if (rk.length > 0) _simSetRecipe(ci2, otherReci2, rk[0].recipeId);
                    }

                    var newScore = _calcScore();
                    if (newScore > _bestScore && _checkGlobalMaterialFeasible()) {
                        console.log('[厨神大赛] RE轻注入提升: ' + reRd.name + ' [RE+' + reRecipes[ri].bonus + '] → 位置' + ci2 + '菜' + reci2 + ' 分数=' + newScore);
                        _bestScore = newScore;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        _logCurrentCombo('RE轻注入 ' + reRd.name, newScore);
                        usedREIds[reRd.recipeId] = true;
                    } else {
                        _simState = savedState;
                    }
                }
            }
        }

        if (improved) {
            _simState = _cloneSimState(_bestSimState);
        }
        return improved;
    }


    function _climbQuantityRedistribute() {
        var improved = false;
        var ruleState = _simState[0];

        // 收集所有有菜谱的slot
        var slots = [];
        for (var ci = 0; ci < 3; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = ruleState[ci].recipes[reci];
                if (rec.data && rec.quantity >= 0) {
                    slots.push({ci: ci, reci: reci});
                }
            }
        }

        // 短路：如果所有菜谱的份数都已等于最大值，无需再分配
        var allAtMax = true;
        for (var si = 0; si < slots.length; si++) {
            var s = slots[si];
            var rec = ruleState[s.ci].recipes[s.reci];
            if (rec.data && rec.quantity < rec.max) {
                allAtMax = false;
                break;
            }
        }
        if (allAtMax && slots.length > 0) {
            console.log('[厨神大赛] 份数再分配短路: 所有菜谱已达最大份数');
            return false;
        }

        var _qtyStartScore = _bestScore;

        // 步骤0：尝试把每道菜推到全局食材允许的最大值
        for (var si = 0; si < slots.length; si++) {
            var s = slots[si];
            var rec = ruleState[s.ci].recipes[s.reci];
            if (!rec.data) continue;
            _calcScore();
            if (rec.quantity < rec.max) {
                var globalRemain = _calcGlobalRemainMaterials(s.ci, s.reci);
                var canMake = rec.max;
                if (globalRemain) {
                    var matLimit = calculateMaterialLimit(globalRemain, rec.data, ruleState[s.ci].chefObj);
                    canMake = Math.min(canMake, matLimit);
                }
                if (canMake > rec.quantity) {
                    var savedQty = rec.quantity;
                    rec.quantity = canMake;
                    var newScore = _calcScore();
                    if (newScore > _bestScore && _checkGlobalMaterialFeasible()) {
                        _bestScore = newScore;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                    } else {
                        rec.quantity = savedQty;
                    }
                }
            }
        }

        // 步骤1：大步调整 A+N/B-N (N=5,3,2)，从大步到小步
        var bigSteps = [5, 3, 2];
        for (var bsi = 0; bsi < bigSteps.length; bsi++) {
            var N = bigSteps[bsi];
            var bigStepImproved = true;
            var bigStepIter = 0;
            while (bigStepImproved && bigStepIter < 20) {
                bigStepImproved = false;
                bigStepIter++;
                for (var i = 0; i < slots.length; i++) {
                    for (var j = 0; j < slots.length; j++) {
                        if (i === j) continue;
                        var si2 = slots[i], sj2 = slots[j];
                        var recA = ruleState[si2.ci].recipes[si2.reci];
                        var recB = ruleState[sj2.ci].recipes[sj2.reci];
                        if (!recA.data || !recB.data) continue;
                        if (recB.quantity < N) continue;

                        var savedA = recA.quantity;
                        var savedB = recB.quantity;
                        recA.quantity = savedA + N;
                        recB.quantity = savedB - N;
                        var newScore = _calcScore();
                        var actualA = recA.quantity;

                        if (newScore > _bestScore && actualA >= savedA + N && _checkGlobalMaterialFeasible()) {
                            _bestScore = newScore;
                            _bestSimState = _cloneSimState(_simState);
                            improved = true;
                            bigStepImproved = true;
                        } else {
                            recA.quantity = savedA;
                            recB.quantity = savedB;
                        }
                    }
                }
            }
        }

        // 步骤2+3：小步微调 A+1/B-1 + 单独+1
        var maxIterations = 50;
        for (var iter = 0; iter < maxIterations; iter++) {
            var iterImproved = false;

            // 2. A+1/B-1
            for (var i = 0; i < slots.length; i++) {
                for (var j = 0; j < slots.length; j++) {
                    if (i === j) continue;
                    var si3 = slots[i], sj3 = slots[j];
                    var recA = ruleState[si3.ci].recipes[si3.reci];
                    var recB = ruleState[sj3.ci].recipes[sj3.reci];
                    if (!recA.data || !recB.data) continue;
                    if (recB.quantity <= 0) continue;

                    var savedA = recA.quantity;
                    var savedB = recB.quantity;
                    recB.quantity = savedB - 1;
                    recA.quantity = savedA + 1;
                    var newScore = _calcScore();
                    var actualA = recA.quantity;

                    if (newScore > _bestScore && actualA > savedA && _checkGlobalMaterialFeasible()) {
                        _bestScore = newScore;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        iterImproved = true;
                    } else {
                        recA.quantity = savedA;
                        recB.quantity = savedB;
                    }
                }
            }

            // 3. 单独+1
            for (var si4 = 0; si4 < slots.length; si4++) {
                var s = slots[si4];
                var rec = ruleState[s.ci].recipes[s.reci];
                if (!rec.data) continue;

                var savedQty = rec.quantity;
                rec.quantity = savedQty + 1;
                var newScore = _calcScore();
                var actualQty = rec.quantity;

                if (newScore > _bestScore && actualQty > savedQty && _checkGlobalMaterialFeasible()) {
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    iterImproved = true;
                } else {
                    rec.quantity = savedQty;
                }
            }

            if (!iterImproved) break;
        }

        if (improved) {
            console.log('[厨神大赛] 份数再分配: ' + _qtyStartScore + '→' + _bestScore + ' (+' + (_bestScore - _qtyStartScore) + ')');
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _climbLowQtyRecipeReplaceLite() {
        var improved = false;
        var ruleState = _simState[0];
        var startScore = _bestScore;

        for (var ci = 0; ci < 3; ci++) {
            for (var reci = 0; reci < 3; reci++) {
                var rec = ruleState[ci].recipes[reci];
                if (!rec.data) continue;

                _calcScore();
                if (rec.max <= 0) continue;
                if (rec.quantity >= rec.max * 0.6) continue;

                var oldName = rec.data.name;
                var oldQty = rec.quantity;
                var oldMax = rec.max;
                var curRecId = rec.data.recipeId;
                var rk = _fastGetRecipeRanking(ci, reci, 8, true);

                for (var ki = 0; ki < rk.length; ki++) {
                    if (rk[ki].recipeId === curRecId) continue;

                    var savedState = _cloneSimState(_simState);
                    _simSetRecipe(ci, reci, rk[ki].recipeId);
                    var newRec = ruleState[ci].recipes[reci];
                    if (!newRec.data) {
                        _simState = savedState;
                        ruleState = _simState[0];
                        continue;
                    }

                    var newScore = _calcScore();
                    var newUtil = newRec.max > 0 ? newRec.quantity / newRec.max : 0;
                    if (newScore > _bestScore && newUtil >= 0.5 && _checkGlobalMaterialFeasible()) {
                        console.log('[厨神大赛] 低份数轻替换: 位置' + ci + '-' + reci + ' ' +
                            oldName + '×' + oldQty + '/' + oldMax + ' → ' +
                            newRec.data.name + '×' + newRec.quantity + '/' + newRec.max +
                            ' 分数=' + newScore);
                        _bestScore = newScore;
                        _bestSimState = _cloneSimState(_simState);
                        improved = true;
                        _logCurrentCombo('低份数轻替换 位置' + ci + '菜' + reci, newScore);
                        break;
                    } else {
                        _simState = savedState;
                        ruleState = _simState[0];
                    }
                }

                _simState = _cloneSimState(_bestSimState);
                ruleState = _simState[0];
                rec = ruleState[ci].recipes[reci];
                if (!rec.data) continue;
                _calcScore();
                if (rec.max <= 0 || rec.quantity >= rec.max * 0.6) continue;

                var lowRd = rec.data;
                var curQty = rec.quantity;
                var lowMats = {};
                for (var m = 0; m < lowRd.materials.length; m++) {
                    lowMats[lowRd.materials[m].material] = true;
                }

                function _calcSharedMaterialUsage(recObj, chefObj) {
                    if (!recObj || !recObj.data) return 0;
                    var totalUse = 0;
                    for (var mm = 0; mm < recObj.data.materials.length; mm++) {
                        var matInfo = recObj.data.materials[mm];
                        if (!lowMats[matInfo.material]) continue;
                        totalUse += calMaterialReduce(chefObj, matInfo.material, matInfo.quantity) * (recObj.quantity || 0);
                    }
                    return totalUse;
                }

                var baseState = _cloneSimState(_simState);
                var bestRelease = null;

                for (var oci = 0; oci < 3; oci++) {
                    for (var oreci = 0; oreci < 3; oreci++) {
                        if (oci === ci && oreci === reci) continue;
                        var otherRec = baseState[0][oci].recipes[oreci];
                        if (!otherRec.data) continue;

                        var oldSharedUsage = _calcSharedMaterialUsage(otherRec, baseState[0][oci].chefObj);
                        if (oldSharedUsage <= 0) continue;

                        var otherRk = _fastGetRecipeRanking(oci, oreci, 5, true);
                        for (var oki = 0; oki < otherRk.length; oki++) {
                            if (otherRk[oki].recipeId === otherRec.data.recipeId) continue;

                            var candidateRd = _recipeMap[otherRk[oki].recipeId];
                            if (!candidateRd) continue;

                            _simState = _cloneSimState(baseState);
                            ruleState = _simState[0];
                            _simSetRecipe(oci, oreci, candidateRd.recipeId);
                            var newOtherRec = ruleState[oci].recipes[oreci];
                            if (!newOtherRec.data || newOtherRec.data.recipeId !== candidateRd.recipeId) continue;

                            var newSharedUsage = _calcSharedMaterialUsage(newOtherRec, ruleState[oci].chefObj);
                            if (newSharedUsage >= oldSharedUsage) continue;

                            var newRemain = _calcRemainMaterials(ci, reci);
                            var newQty = getRecipeQuantity(lowRd, newRemain, _rule, ruleState[ci].chefObj);
                            if (_rule.MaterialsLimit && _materialsAll) {
                                var newGlobalRemain = _calcGlobalRemainMaterials(ci, reci);
                                var matLim = calculateMaterialLimit(newGlobalRemain, lowRd, ruleState[ci].chefObj);
                                newQty = Math.min(newQty, matLim);
                            }
                            if (_rule.DisableMultiCookbook) newQty = Math.min(newQty, 1);
                            ruleState[ci].recipes[reci].quantity = newQty;

                            if (newQty <= curQty) continue;

                            var releaseScore = _calcScore();
                            if (releaseScore <= _bestScore || !_checkGlobalMaterialFeasible()) continue;

                            if (!bestRelease || releaseScore > bestRelease.score) {
                                bestRelease = {
                                    score: releaseScore,
                                    state: _cloneSimState(_simState),
                                    oldOtherName: otherRec.data.name,
                                    newOtherName: newOtherRec.data.name,
                                    oldQty: curQty,
                                    newQty: newQty,
                                    ci: oci,
                                    oreci: oreci,
                                    oldSharedUsage: oldSharedUsage,
                                    newSharedUsage: newSharedUsage
                                };
                            }
                        }
                    }
                }

                if (bestRelease) {
                    _simState = _cloneSimState(bestRelease.state);
                    _bestScore = bestRelease.score;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    console.log('[厨神大赛] 食材释放轻替换: 位置' + bestRelease.ci + '-' + bestRelease.oreci + ' ' +
                        bestRelease.oldOtherName + ' → ' + bestRelease.newOtherName +
                        ', ' + lowRd.name + ' ' + bestRelease.oldQty + '→' + bestRelease.newQty +
                        ', 共享食材消耗 ' + bestRelease.oldSharedUsage + '→' + bestRelease.newSharedUsage +
                        ' 分数=' + bestRelease.score);
                    _logCurrentCombo('食材释放轻替换 位置' + ci + '菜' + reci, bestRelease.score);
                } else {
                    _simState = _cloneSimState(_bestSimState);
                }
                ruleState = _simState[0];
            }
        }

        if (improved) {
            console.log('[厨神大赛] 低份数轻替换: ' + startScore + '→' + _bestScore + ' (+' + (_bestScore - startScore) + ')');
        }
        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _positionRebuildLite() {
        if (_singleTrio) return false;

        var improved = false;
        var rankedAll = _rankChefsForSeed();

        for (var targetCi = 0; targetCi < 3; targetCi++) {
            var usedIds = _getUsedChefIds(targetCi);
            var candidates = [];

            for (var ri = 0; ri < rankedAll.length; ri++) {
                if (usedIds[rankedAll[ri].chefId]) continue;
                candidates.push(rankedAll[ri]);
                if (candidates.length >= 6) break;
            }

            for (var j = 0; j < candidates.length; j++) {
                var savedState = _cloneSimState(_simState);
                _simState[0][targetCi] = {
                    chefId: null,
                    chefObj: null,
                    equipObj: {},
                    condiment: {},
                    recipes: [
                        {data:null,quantity:0,max:0},
                        {data:null,quantity:0,max:0},
                        {data:null,quantity:0,max:0}
                    ]
                };
                _simSetChef(targetCi, candidates[j].chefId);
                for (var reci = 0; reci < 3; reci++) {
                    var rk = _fastGetRecipeRanking(targetCi, reci, 1, true);
                    if (rk.length > 0) _simSetRecipe(targetCi, reci, rk[0].recipeId);
                }
                _quickRefineFast(true);
                var newScore = _calcScore();

                if (newScore > _bestScore && _checkGlobalMaterialFeasible()) {
                    console.log('[厨神大赛] 位置轻重建提升: 位置' + targetCi + ' ' + candidates[j].chefName + ' 分数=' + newScore);
                    _bestScore = newScore;
                    _bestSimState = _cloneSimState(_simState);
                    improved = true;
                    _logCurrentCombo('位置轻重建 位置' + targetCi + ' ' + candidates[j].chefName, newScore);
                } else {
                    _simState = savedState;
                }
            }
        }

        _simState = _cloneSimState(_bestSimState);
        return improved;
    }


    function _applySimStateToSystem(simState) {
        var stateToApply = simState;
        var normalized = _normalizeFeasibleState(simState);
        if (normalized && normalized.state) {
            stateToApply = normalized.state;
            if (simState === _simState) {
                _simState = _cloneSimState(normalized.state);
            }
            if (simState === _bestSimState) {
                _bestScore = normalized.score;
                _bestSimState = _cloneSimState(normalized.state);
            }
        } else {
            console.warn('[厨神大赛] 写回前规范化失败，使用原状态继续写回');
        }

        // 先清空已有页面状态，避免空槽残留旧菜谱/旧厨师
        for (var clearCi = 0; clearCi < stateToApply[0].length; clearCi++) {
            for (var clearRi = 0; clearRi < stateToApply[0][clearCi].recipes.length; clearRi++) {
                if (typeof setCustomRecipe === 'function') {
                    setCustomRecipe(0, clearCi, clearRi, null);
                }
            }
            if (typeof setCustomEquip === 'function') {
                setCustomEquip(0, clearCi, null);
            }
            if (typeof setCustomChef === 'function') {
                setCustomChef(0, clearCi, null);
            }
        }

        // 第一步：设置厨师和菜谱（系统会自动算份数，但可能不准）
        for (var ci = 0; ci < stateToApply[0].length; ci++) {
            var slot = stateToApply[0][ci];
            if (slot.chefId && typeof setCustomChef === 'function') {
                setCustomChef(0, ci, slot.chefId);
            }
            for (var reci = 0; reci < slot.recipes.length; reci++) {
                if (slot.recipes[reci].data && typeof setCustomRecipe === 'function') {
                    setCustomRecipe(0, ci, reci, slot.recipes[reci].data.recipeId);
                }
            }
        }

        // 第二步：强制设置优化器算出的份数
        if (typeof setCustomRecipeQuantity === 'function') {
            for (var ci = 0; ci < stateToApply[0].length; ci++) {
                var slot = stateToApply[0][ci];
                for (var reci = 0; reci < slot.recipes.length; reci++) {
                    if (slot.recipes[reci].data && slot.recipes[reci].quantity > 0) {
                        setCustomRecipeQuantity(0, ci, reci, slot.recipes[reci].quantity);
                    }
                }
            }
        }

        // 第三步：写回厨具、遗玉和心法盘等级（始终写回，不管是否勾选"已配厨具"/"已配遗玉"）
        for (var ci = 0; ci < stateToApply[0].length; ci++) {
            var slot = stateToApply[0][ci];
            
            // 写回厨具
            if (slot.equipObj && slot.equipObj.equipId && typeof setCustomEquip === 'function') {
                setCustomEquip(0, ci, slot.equipObj.equipId);
            }
            
            // 写回心法盘等级
            if (slot.chefObj && slot.chefObj.disk && slot.chefObj.disk.level && typeof setCustomDiskLevel === 'function') {
                setCustomDiskLevel(0, ci, slot.chefObj.disk.level);
            }
            
            // 写回遗玉
            if (slot.chefObj && slot.chefObj.disk && slot.chefObj.disk.ambers) {
                for (var ai = 0; ai < slot.chefObj.disk.ambers.length; ai++) {
                    var amberData = slot.chefObj.disk.ambers[ai].data;
                    if (amberData && amberData.amberId && typeof setCustomAmber === 'function') {
                        setCustomAmber(0, ci, ai, amberData.amberId);
                    }
                }
            }
        }
        console.log('[厨神大赛] 厨具、遗玉和心法盘等级已写回系统');

        // 第四步：写回调料
        // 尝试多种方式获取 gameData
        var gameData = _gameData 
            || (typeof window.gameData !== 'undefined' ? window.gameData : null)
            || (typeof calCustomRule !== 'undefined' && calCustomRule.gameData ? calCustomRule.gameData : null);

        for (var ci = 0; ci < simState[0].length; ci++) {
            var slot = simState[0][ci];
            if (slot.condiment && slot.condiment.condimentId && typeof setCustomCondiment === 'function') {
                if (gameData) {
                    setCustomCondiment(0, ci, slot.condiment.condimentId, gameData);
                } else {
                    console.warn('[厨神大赛] gameData不可用，跳过调料设置');
                }
            }
        }

        // 第五步：刷新页面显示（调用 calCustomResults 重新计算并渲染）
        if (gameData && typeof calCustomResults === 'function') {
            calCustomResults(gameData);
            console.log('[厨神大赛] 页面显示已刷新');
        } else {
            console.warn('[厨神大赛] 无法刷新页面显示：gameData=' + (gameData ? '有' : '无') + ', calCustomResults=' + (typeof calCustomResults !== 'undefined' ? '有' : '无'));
        }

        console.log('[厨神大赛] 写回系统完成');
    }


    function _logFinalCombination() {
        if (!_bestSimState || !_bestSimState[0]) return;
        console.log('[厨神大赛] === 最终组合详情 (最佳种子: ' + _bestSeedSource + ') ===');

        _simState = _cloneSimState(_bestSimState);
        var ruleState = _simState[0];
        var customArr = [];
        for (var ci = 0; ci < ruleState.length; ci++) {
            customArr.push({
                chef: ruleState[ci].chefObj || {},
                equip: ruleState[ci].equipObj || {},
                recipes: ruleState[ci].recipes,
                condiment: {}
            });
        }
        var partialRecipeAdds = getPartialRecipeAdds(customArr, _rule);

        var totalRaw = 0;
        for (var ci = 0; ci < _bestSimState[0].length; ci++) {
            var slot = _bestSimState[0][ci];
            var chefName = slot.chefId ? _getChefNameById(slot.chefId) : '未选择';
            var recipes = [];
            var chefTotal = 0;
            for (var reci = 0; reci < slot.recipes.length; reci++) {
                var rec = slot.recipes[reci];
                if (rec.data) {
                    var reBonus = '';
                    if (_rule && _rule.RecipeEffect) {
                        var reStr = rec.data.recipeId.toString();
                        var reNum = Number(rec.data.recipeId);
                        var bonus = _rule.RecipeEffect[reStr] != null ? _rule.RecipeEffect[reStr] : (_rule.RecipeEffect[reNum] != null ? _rule.RecipeEffect[reNum] : 0);
                        if (bonus > 0) reBonus = ' [RE+' + bonus + ']';
                    }
                    // 算单菜分数
                    var g = getRecipeResult(
                        ruleState[ci].chefObj,
                        ruleState[ci].equipObj,
                        rec.data,
                        rec.quantity,
                        rec.max,
                        _rule.materials,
                        _rule,
                        _rule.decorationEffect,
                        null,
                        true,
                        customArr[ci].recipes,
                        partialRecipeAdds[3 * ci + reci],
                        null
                    );
                    var actAdd = (g.data && g.data.activityAddition) ? g.data.activityAddition : 0;
                    var recScore = Math.ceil(+(g.totalScore * (1 + actAdd / 100)).toFixed(2));
                    chefTotal += recScore;
                    totalRaw += recScore;
                    recipes.push(rec.data.name + '×' + rec.quantity + '/' + rec.max + reBonus + ' 分=' + recScore);
                } else {
                    recipes.push('空');
                }
            }
            var equipName = slot.equipObj && slot.equipObj.name ? ' [厨具:' + slot.equipObj.name + ']' : '';
            var amberNames = '';
            if (_autoAmber && slot.chefObj && slot.chefObj.disk && slot.chefObj.disk.ambers) {
                var aNames = [];
                for (var ai = 0; ai < slot.chefObj.disk.ambers.length; ai++) {
                    var ad = slot.chefObj.disk.ambers[ai].data;
                    if (ad && ad.name) aNames.push(ad.name);
                }
                if (aNames.length > 0) amberNames = ' [遗玉:' + aNames.join(',') + ']';
            }
            console.log('[厨神大赛] 位置' + (ci + 1) + ': ' + chefName + equipName + amberNames + ' (小计=' + chefTotal + ') → ' + recipes.join(', '));
        }

        // 算最终分（含scoreMultiply/scorePow/scoreAdd）
        var h = 1, m = 1, v = 0;
        if (_rule.hasOwnProperty("scoreMultiply")) h = _rule.scoreMultiply;
        if (_rule.hasOwnProperty("scorePow")) m = _rule.scorePow;
        if (_rule.hasOwnProperty("scoreAdd")) v = _rule.scoreAdd;
        var finalCalc = +(Math.pow(totalRaw, m) * h).toFixed(2);
        finalCalc = _rule.IsActivity ? Math.ceil(finalCalc) : Math.floor(finalCalc);
        if (finalCalc) finalCalc += v;
        console.log('[厨神大赛] 菜谱原始总分=' + totalRaw + ' 最终计算分=' + finalCalc + ' (multiply=' + h + ' pow=' + m + ' add=' + v + ')');
    }


    function applyResult() {
        if (typeof calCustomResults === 'function') {
            calCustomResults(_gameData);
        }
        var score = (typeof calCustomRule !== 'undefined' && calCustomRule) ? (calCustomRule.score || 0) : 0;
        return { actualScore: score };
    }


    function _generateInitialSolution(onDone) {
        _initSimState();
        _topCandidates = [];
        var reSingleSeedTop = 5;
        var reComboTop = 6;
        var reChefSeedTop = 3;
        var reMaxChefTop = 4;
        var reMaxSeedCap = 6;
        var rePermChefTop = 5;
        var rePermTrioCap = 4;
        var rePermTryCap = 240;
        var materialSeedCap1 = 5;
        var materialSeedCap2 = 10;

        var auraChefs = _analyzePriceAuraChefs();
        var recipeEffects = _analyzeRecipeEffects();
        var chefTagEffects = _analyzeChefTagEffects();
        var synergyPairs = _buildSynergyPairs();
        var seedStart = Date.now();

        console.log('[厨神大赛] 种子分析: 光环厨师' + auraChefs.length + '个, RecipeEffect菜谱' + recipeEffects.length + '个, ChefTagEffect厨师' + chefTagEffects.length + '个, 协同对' + synergyPairs.length + '个');
        if (recipeEffects.length > 0) {
            var reTop3 = [];
            for (var rti = 0; rti < Math.min(3, recipeEffects.length); rti++) {
                reTop3.push(recipeEffects[rti].recipeName + '(+' + recipeEffects[rti].bonus + ')');
            }
            console.log('[厨神大赛] RE菜谱top3: ' + reTop3.join(', '));
        }
        console.log('[厨神大赛] === 开始种子生成(紧凑增强版) ===');

        function pushCurrent(source) {
            _quickRefineFast(true);
            var score = _calcScore();
            _topCandidates.push({ state: _cloneSimState(_simState), score: score, source: source });
        }

        function fillOtherPositions() {
            for (var ci = 0; ci < 3; ci++) _greedyFillPosition(ci);
        }

        for (var ai = 0; ai < Math.min(3, auraChefs.length); ai++) {
            for (var pos = 0; pos < 3; pos++) {
                _initSimState();
                _simSetChef(pos, auraChefs[ai].chefId);
                for (var ri = 0; ri < 3; ri++) {
                    var rk = _fastGetRecipeRanking(pos, ri, 1, true);
                    if (rk.length > 0) _simSetRecipe(pos, ri, rk[0].recipeId);
                }
                fillOtherPositions();
                pushCurrent('光环-' + auraChefs[ai].chefName + '@' + pos);
            }
        }
        console.log('[厨神大赛] 种子1(光环)完成: ' + _topCandidates.length + '个候选');

        if (recipeEffects.length > 0) {
            for (var rei = 0; rei < Math.min(reSingleSeedTop, recipeEffects.length); rei++) {
                for (var pos1 = 0; pos1 < 3; pos1++) {
                    _initSimState();
                    _simSetRecipe(pos1, 0, recipeEffects[rei].recipeId);
                    _greedyFillAll();
                    pushCurrent('RecipeEffect-' + recipeEffects[rei].recipeName + '@' + pos1);
                }
            }

            var reTopN = Math.min(reComboTop, recipeEffects.length);
            var reCombos = [];
            for (var i = 0; i < reTopN; i++) {
                for (var j = i + 1; j < reTopN; j++) {
                    reCombos.push([i, j]);
                }
            }
            if (reTopN >= 3) {
                for (var ci3 = 0; ci3 < Math.min(4, reTopN); ci3++) {
                    for (var cj3 = ci3 + 1; cj3 < Math.min(5, reTopN); cj3++) {
                        for (var ck3 = cj3 + 1; ck3 < reTopN; ck3++) {
                            reCombos.push([ci3, cj3, ck3]);
                        }
                    }
                }
            }

            for (var comboIdx = 0; comboIdx < reCombos.length; comboIdx++) {
                var combo = reCombos[comboIdx];
                _initSimState();
                var comboNames = [];
                for (var ri2 = 0; ri2 < combo.length && ri2 < 3; ri2++) {
                    _simSetRecipe(ri2, 0, recipeEffects[combo[ri2]].recipeId);
                    comboNames.push(recipeEffects[combo[ri2]].recipeName);
                }
                _greedyFillAll();
                pushCurrent('RE组合-' + comboNames.join('+'));
            }

            for (var rc = 0; rc < Math.min(reChefSeedTop, recipeEffects.length); rc++) {
                _initSimState();
                _simSetRecipe(0, 0, recipeEffects[rc].recipeId);
                var chefRk = _fastGetChefRanking(0, true);
                for (var cc = 0; cc < Math.min(3, chefRk.length); cc++) {
                    if (chefRk[cc].skillOk === false) continue;
                    _initSimState();
                    _simSetChef(0, chefRk[cc].chefId);
                    _simSetRecipe(0, 0, recipeEffects[rc].recipeId);
                    for (var reci = 1; reci < 3; reci++) {
                        var rkChef = _fastGetRecipeRanking(0, reci, 1, true);
                        if (rkChef.length > 0) _simSetRecipe(0, reci, rkChef[0].recipeId);
                    }
                    for (var fillPos = 1; fillPos < 3; fillPos++) _greedyFillPosition(fillPos);
                    pushCurrent('RE厨师-' + recipeEffects[rc].recipeName + '+' + _getChefNameById(chefRk[cc].chefId));
                }
            }

            if (recipeEffects.length >= 3) {
                var rankedChefsForRE = _rankChefsForSeed();
                var topChefsForRE = Math.min(reMaxChefTop, rankedChefsForRE.length);
                var reMaxCount = 0;

                for (var ciRE = 0; ciRE < topChefsForRE && reMaxCount < reMaxSeedCap; ciRE++) {
                    for (var cjRE = ciRE + 1; cjRE < topChefsForRE && reMaxCount < reMaxSeedCap; cjRE++) {
                        for (var ckRE = cjRE + 1; ckRE < topChefsForRE && reMaxCount < reMaxSeedCap; ckRE++) {
                            var trio = [rankedChefsForRE[ciRE], rankedChefsForRE[cjRE], rankedChefsForRE[ckRE]];
                            _initSimState();
                            for (var posRE = 0; posRE < 3; posRE++) _simSetChef(posRE, trio[posRE].chefId);

                            var usedReIds = {};
                            for (var posChef = 0; posChef < 3; posChef++) {
                                var chefObj = _simState[0][posChef].chefObj;
                                if (!chefObj) continue;
                                var reForChef = [];
                                for (var rei2 = 0; rei2 < recipeEffects.length; rei2++) {
                                    var reRd = _recipeMap[recipeEffects[rei2].recipeId] || _recipeMap[Number(recipeEffects[rei2].recipeId)];
                                    if (!reRd || usedReIds[reRd.recipeId]) continue;
                                    if (reRd.stirfry > 0 && (!chefObj.stirfryVal || chefObj.stirfryVal < reRd.stirfry)) continue;
                                    if (reRd.boil > 0 && (!chefObj.boilVal || chefObj.boilVal < reRd.boil)) continue;
                                    if (reRd.knife > 0 && (!chefObj.knifeVal || chefObj.knifeVal < reRd.knife)) continue;
                                    if (reRd.fry > 0 && (!chefObj.fryVal || chefObj.fryVal < reRd.fry)) continue;
                                    if (reRd.bake > 0 && (!chefObj.bakeVal || chefObj.bakeVal < reRd.bake)) continue;
                                    if (reRd.steam > 0 && (!chefObj.steamVal || chefObj.steamVal < reRd.steam)) continue;
                                    reForChef.push({ rd: reRd, bonus: recipeEffects[rei2].bonus });
                                }
                                var rePlaced = 0;
                                for (var placeIdx = 0; placeIdx < reForChef.length && rePlaced < 3; placeIdx++) {
                                    _simSetRecipe(posChef, rePlaced, reForChef[placeIdx].rd.recipeId);
                                    usedReIds[reForChef[placeIdx].rd.recipeId] = true;
                                    rePlaced++;
                                }
                            }

                            for (var posFill = 0; posFill < 3; posFill++) {
                                for (var slotFill = 0; slotFill < 3; slotFill++) {
                                    if (_simState[0][posFill].recipes[slotFill].data) continue;
                                    var rkFill = _fastGetRecipeRanking(posFill, slotFill, 1, true);
                                    if (rkFill.length > 0) _simSetRecipe(posFill, slotFill, rkFill[0].recipeId);
                                }
                            }

                            pushCurrent('RE最大化-' + trio[0].chefName + '+' + trio[1].chefName + '+' + trio[2].chefName);
                            reMaxCount++;
                        }
                    }
                }
            }

            if (recipeEffects.length >= 2) {
                var reRecipeList = [];
                for (var reiList = 0; reiList < Math.min(5, recipeEffects.length); reiList++) {
                    var rdList = _recipeMap[recipeEffects[reiList].recipeId] || _recipeMap[Number(recipeEffects[reiList].recipeId)];
                    if (rdList) reRecipeList.push(rdList);
                }

                var rankedChefsForPerm = _rankChefsForSeed();
                var topChefsForPerm = Math.min(rePermChefTop, rankedChefsForPerm.length);
                var chefTriosForPerm = [];
                for (var triA = 0; triA < topChefsForPerm; triA++) {
                    for (var triB = triA + 1; triB < topChefsForPerm; triB++) {
                        for (var triC = triB + 1; triC < topChefsForPerm; triC++) {
                            chefTriosForPerm.push([triA, triB, triC]);
                        }
                    }
                }
                if (chefTriosForPerm.length > rePermTrioCap) chefTriosForPerm.length = rePermTrioCap;

                var reCount = Math.min(3, reRecipeList.length);
                var reAssignments = [];
                function _genREAssign(idx, assign, counts) {
                    if (idx >= reCount) {
                        var total = counts[0] + counts[1] + counts[2];
                        if (total >= 2) reAssignments.push(assign.slice());
                        return;
                    }
                    _genREAssign(idx + 1, assign, counts);
                    for (var p = 0; p < 3; p++) {
                        if (counts[p] >= 3) continue;
                        assign[idx] = p;
                        counts[p]++;
                        _genREAssign(idx + 1, assign, counts);
                        counts[p]--;
                        assign[idx] = -1;
                    }
                }

                var initAssign = [];
                for (var initI = 0; initI < reCount; initI++) initAssign.push(-1);
                _genREAssign(0, initAssign, [0, 0, 0]);
                console.log('[厨神大赛] RE全排列: ' + reCount + '个RE菜谱, ' + reAssignments.length + '种分配 × ' + chefTriosForPerm.length + '个厨师三元组');

                var permTries = 0;
                for (var trioIdx = 0; trioIdx < chefTriosForPerm.length && permTries < rePermTryCap; trioIdx++) {
                    var trioRef = chefTriosForPerm[trioIdx];
                    var trioChefs = [rankedChefsForPerm[trioRef[0]], rankedChefsForPerm[trioRef[1]], rankedChefsForPerm[trioRef[2]]];
                    var chefPerms = _getChefPermutations(false);

                    for (var permIdx = 0; permIdx < chefPerms.length && permTries < rePermTryCap; permIdx++) {
                        var cperm = chefPerms[permIdx];
                        for (var assignIdx = 0; assignIdx < reAssignments.length && permTries < rePermTryCap; assignIdx++) {
                            var assign = reAssignments[assignIdx];
                            permTries++;

                            _initSimState();
                            for (var posPerm = 0; posPerm < 3; posPerm++) {
                                _simSetChef(posPerm, trioChefs[cperm[posPerm]].chefId);
                            }

                            var slotUsed = [0, 0, 0];
                            var valid = true;
                            for (var reIdx = 0; reIdx < reCount; reIdx++) {
                                if (assign[reIdx] < 0) continue;
                                var posAssign = assign[reIdx];
                                var reciAssign = slotUsed[posAssign];
                                if (reciAssign >= 3) {
                                    valid = false;
                                    break;
                                }
                                var chefObjPerm = _simState[0][posAssign].chefObj;
                                var rdPerm = reRecipeList[reIdx];
                                if (!chefObjPerm) {
                                    valid = false;
                                    break;
                                }
                                if (rdPerm.stirfry > 0 && (!chefObjPerm.stirfryVal || chefObjPerm.stirfryVal < rdPerm.stirfry)) valid = false;
                                if (rdPerm.boil > 0 && (!chefObjPerm.boilVal || chefObjPerm.boilVal < rdPerm.boil)) valid = false;
                                if (rdPerm.knife > 0 && (!chefObjPerm.knifeVal || chefObjPerm.knifeVal < rdPerm.knife)) valid = false;
                                if (rdPerm.fry > 0 && (!chefObjPerm.fryVal || chefObjPerm.fryVal < rdPerm.fry)) valid = false;
                                if (rdPerm.bake > 0 && (!chefObjPerm.bakeVal || chefObjPerm.bakeVal < rdPerm.bake)) valid = false;
                                if (rdPerm.steam > 0 && (!chefObjPerm.steamVal || chefObjPerm.steamVal < rdPerm.steam)) valid = false;
                                if (!valid) break;
                                _simSetRecipe(posAssign, reciAssign, rdPerm.recipeId);
                                slotUsed[posAssign]++;
                            }
                            if (!valid) continue;

                            for (var posGreedy = 0; posGreedy < 3; posGreedy++) {
                                for (var recGreedy = slotUsed[posGreedy]; recGreedy < 3; recGreedy++) {
                                    var rkGreedy = _fastGetRecipeRanking(posGreedy, recGreedy, 1, true);
                                    if (rkGreedy.length > 0) _simSetRecipe(posGreedy, recGreedy, rkGreedy[0].recipeId);
                                }
                            }

                            var permScore = _calcScore();
                            _topCandidates.push({ state: _cloneSimState(_simState), score: permScore, source: 'RE排列-' + trioChefs[cperm[0]].chefName + '+' + trioChefs[cperm[1]].chefName + '+' + trioChefs[cperm[2]].chefName });
                        }
                    }
                }
                console.log('[厨神大赛] RE全排列种子: 实际尝试' + permTries + '次');
            }
        }
        console.log('[厨神大赛] 种子2(RE)完成: ' + _topCandidates.length + '个候选');

        for (var ti = 0; ti < Math.min(3, chefTagEffects.length); ti++) {
            _initSimState();
            _simSetChef(0, chefTagEffects[ti].chefId);
            fillOtherPositions();
            pushCurrent('ChefTag-' + chefTagEffects[ti].chefName);
        }
        console.log('[厨神大赛] 种子3(ChefTag)完成: ' + _topCandidates.length + '个候选');

        for (var si = 0; si < Math.min(5, synergyPairs.length); si++) {
            _initSimState();
            _simSetChef(0, synergyPairs[si].chefId);
            _simSetRecipe(0, 0, synergyPairs[si].recipeId);
            fillOtherPositions();
            pushCurrent('协同-' + synergyPairs[si].chefName + '+' + synergyPairs[si].recipeName);
        }
        console.log('[厨神大赛] 种子4(协同)完成: ' + _topCandidates.length + '个候选');

        _initSimState();
        _greedyFillAll();
        pushCurrent('贪心');
        console.log('[厨神大赛] 种子5(贪心)完成: ' + _topCandidates.length + '个候选, 贪心分=' + _topCandidates[_topCandidates.length - 1].score);

        console.log('[厨神大赛] 开始生成食材感知种子...');
        var materialSeedStart = Date.now();
        var materialSeedCount = 0;

        if (_materialsAll && _rule.MaterialsLimit) {
            var recipesByMaterial = {};
            for (var mi = 0; mi < _menus.length; mi++) {
                var rd = _menus[mi];
                if (!rd.materials) continue;
                for (var mj = 0; mj < rd.materials.length; mj++) {
                    var matId = rd.materials[mj].material;
                    if (!recipesByMaterial[matId]) recipesByMaterial[matId] = [];
                    recipesByMaterial[matId].push(rd);
                }
            }

            var scarceMaterials = [];
            for (var matKey in recipesByMaterial) {
                var available = _materialsAll[matKey] || 0;
                var demandCount = recipesByMaterial[matKey].length;
                if (available < 50 && demandCount > 5) {
                    scarceMaterials.push({ matId: matKey, available: available, demand: demandCount });
                }
            }
            scarceMaterials.sort(function(a, b) { return (a.available / a.demand) - (b.available / b.demand); });

            if (scarceMaterials.length > 0) {
                var scarceMaterialIds = {};
                for (var smi = 0; smi < Math.min(3, scarceMaterials.length); smi++) {
                    scarceMaterialIds[scarceMaterials[smi].matId] = true;
                }

                var rankedChefsMS = _rankChefsForSeed();
                for (var mci = 0; mci < Math.min(3, rankedChefsMS.length) && materialSeedCount < materialSeedCap1; mci++) {
                    for (var mcj = mci + 1; mcj < Math.min(4, rankedChefsMS.length) && materialSeedCount < materialSeedCap1; mcj++) {
                        for (var mck = mcj + 1; mck < Math.min(5, rankedChefsMS.length) && materialSeedCount < materialSeedCap1; mck++) {
                            _initSimState();
                            _simSetChef(0, rankedChefsMS[mci].chefId);
                            _simSetChef(1, rankedChefsMS[mcj].chefId);
                            _simSetChef(2, rankedChefsMS[mck].chefId);

                            for (var posMS = 0; posMS < 3; posMS++) {
                                for (var recMS = 0; recMS < 3; recMS++) {
                                    var rkMS = _fastGetRecipeRanking(posMS, recMS, 10, true);
                                    var selected = false;
                                    for (var rki = 0; rki < rkMS.length; rki++) {
                                        var candRd = _recipeMap[rkMS[rki].recipeId];
                                        if (!candRd) continue;
                                        var candUsesScarce = false;
                                        if (candRd.materials) {
                                            for (var cmj = 0; cmj < candRd.materials.length; cmj++) {
                                                if (scarceMaterialIds[candRd.materials[cmj].material]) {
                                                    candUsesScarce = true;
                                                    break;
                                                }
                                            }
                                        }
                                        if (!candUsesScarce) {
                                            _simSetRecipe(posMS, recMS, rkMS[rki].recipeId);
                                            selected = true;
                                            break;
                                        }
                                    }
                                    if (!selected && rkMS.length > 0) _simSetRecipe(posMS, recMS, rkMS[0].recipeId);
                                }
                            }

                            pushCurrent('食材感知-避稀缺-' + rankedChefsMS[mci].chefName + '+' + rankedChefsMS[mcj].chefName + '+' + rankedChefsMS[mck].chefName);
                            materialSeedCount++;
                        }
                    }
                }
            }

            var materialGroups = {};
            for (var mgi = 0; mgi < _menus.length; mgi++) {
                var mgRd = _menus[mgi];
                if (!mgRd.materials || mgRd.materials.length === 0) continue;
                var maxMat = null;
                var maxQty = 0;
                for (var mgj = 0; mgj < mgRd.materials.length; mgj++) {
                    if (mgRd.materials[mgj].quantity > maxQty) {
                        maxQty = mgRd.materials[mgj].quantity;
                        maxMat = mgRd.materials[mgj].material;
                    }
                }
                if (maxMat) {
                    if (!materialGroups[maxMat]) materialGroups[maxMat] = [];
                    materialGroups[maxMat].push(mgRd);
                }
            }

            var groupKeys = Object.keys(materialGroups);
            if (groupKeys.length >= 3) {
                for (var gi = 0; gi < Math.min(3, groupKeys.length) && materialSeedCount < materialSeedCap2; gi++) {
                    for (var gj = gi + 1; gj < Math.min(4, groupKeys.length) && materialSeedCount < materialSeedCap2; gj++) {
                        for (var gk = gj + 1; gk < Math.min(5, groupKeys.length) && materialSeedCount < materialSeedCap2; gk++) {
                            var group1 = materialGroups[groupKeys[gi]];
                            var group2 = materialGroups[groupKeys[gj]];
                            var group3 = materialGroups[groupKeys[gk]];
                            if (!(group1.length > 0 && group2.length > 0 && group3.length > 0)) continue;

                            _initSimState();
                            var rankedChefsMS2 = _rankChefsForSeed();
                            if (rankedChefsMS2.length < 3) continue;
                            _simSetChef(0, rankedChefsMS2[0].chefId);
                            _simSetChef(1, rankedChefsMS2[1].chefId);
                            _simSetChef(2, rankedChefsMS2[2].chefId);
                            _simSetRecipe(0, 0, group1[0].recipeId);
                            _simSetRecipe(1, 0, group2[0].recipeId);
                            _simSetRecipe(2, 0, group3[0].recipeId);
                            _greedyFillAll();
                            pushCurrent('食材互补-' + groupKeys[gi] + '+' + groupKeys[gj] + '+' + groupKeys[gk]);
                            materialSeedCount++;
                        }
                    }
                }
            }
        }
        console.log('[厨神大赛] 种子5d(食材感知)完成: ' + materialSeedCount + '个种子, ' + _topCandidates.length + '个候选, 耗时=' + ((Date.now() - materialSeedStart) / 1000).toFixed(1) + 's');

        var rankedChefs = _rankChefsForSeed();
        var topNames = [];
        for (var i = 0; i < Math.min(5, rankedChefs.length); i++) topNames.push(rankedChefs[i].chefName);
        console.log('[厨神大赛] 厨师排名top5: ' + topNames.join(', '));

        _generateChefTripleSeeds(rankedChefs, function(tripleSeeds) {
            console.log('[厨神大赛] 三元组种子生成: ' + tripleSeeds.length + '个');
            for (var ti = 0; ti < tripleSeeds.length; ti++) _topCandidates.push(tripleSeeds[ti]);

            _topCandidates.sort(function(a, b) { return b.score - a.score; });
            var deduped = [];
            var seen = {};
            for (var ci = 0; ci < _topCandidates.length; ci++) {
                var candidate = _topCandidates[ci];
                var key = _getStateRecipeSignature(candidate.state, false);
                if (seen[key]) continue;
                seen[key] = true;
                deduped.push(candidate);
            }
            _topCandidates = deduped;

            if (_topCandidates.length > 0) {
                _bestScore = _topCandidates[0].score;
                _bestSimState = _cloneSimState(_topCandidates[0].state);
                _simState = _cloneSimState(_bestSimState);
                _normalizeBestState('种子生成完成');
                console.log('[厨神大赛] 种子生成完成: ' + _topCandidates.length + '个候选, 最佳=' + _bestScore + ' (' + _topCandidates[0].source + ') 耗时=' + ((Date.now() - seedStart) / 1000).toFixed(1) + 's');
                for (var di = 0; di < Math.min(5, _topCandidates.length); di++) {
                    console.log('  种子#' + (di + 1) + ': ' + _topCandidates[di].source + ' 分=' + _topCandidates[di].score);
                }
            }

            if (typeof onDone === 'function') onDone();
        });
    }

    function _runClimbingPhase(round, onDone, noImprovementCount) {
        if (typeof noImprovementCount === 'undefined') noImprovementCount = 0;
        if (round >= CONFIG.maxRounds) {
            if (_preRestartBestScore > _bestScore && _preRestartBestState) {
                _bestScore = _preRestartBestScore;
                _bestSimState = _cloneSimState(_preRestartBestState);
                _simState = _cloneSimState(_bestSimState);
            }
            if (typeof onDone === 'function') onDone();
            return;
        }

        var roundStart = Date.now();
        var roundStartScore = _bestScore;
        var improved = { chef: false, dualChef: false, swap: false, recipe: false, recipeSwap: false, joint: false, reselect: false, reInject: false, quantity: false, postQty: false, lowQty: false, rebuild: false, newbieEquip: false };
        var steps = [];

        if (!_singleTrio) {
            steps.push(function() {
                _simState = _cloneSimState(_bestSimState);
                improved.chef = _climbChefs();
                _simState = _cloneSimState(_bestSimState);
                improved.dualChef = _climbDualChefs();
                if (improved.dualChef) improved.chef = true;
            });
        }
        if (!_singleTrio) {
            steps.push(function() {
                _simState = _cloneSimState(_bestSimState);
                improved.swap = _climbChefSwap();
            });
        }
        steps.push(function() {
            _simState = _cloneSimState(_bestSimState);
            improved.recipe = _climbRecipes();
        });
        steps.push(function() {
            _simState = _cloneSimState(_bestSimState);
            improved.recipeSwap = _climbRecipeSwap();
        });
        if (!_singleTrio) {
            steps.push(function() {
                _simState = _cloneSimState(_bestSimState);
                improved.joint = _climbJointChefRecipe();
            });
        }
        steps.push(function() {
            _simState = _cloneSimState(_bestSimState);
            improved.reselect = _climbRecipeReselect();
            _simState = _cloneSimState(_bestSimState);
            improved.reselect = _climbMultiPositionRebuild() || improved.reselect;
        });
        if (round === 0) {
            steps.push(function() {
                _simState = _cloneSimState(_bestSimState);
                improved.reInject = _climbInjectRecipeEffectLite();
            });
        }
        steps.push(function() {
            _simState = _cloneSimState(_bestSimState);
            improved.quantity = _climbQuantityRedistribute();
        });
        {
            steps.push(function() {
                if (!improved.quantity) return;
                _simState = _cloneSimState(_bestSimState);
                var postRecipe = _climbRecipes();
                _simState = _cloneSimState(_bestSimState);
                var postSwap = _climbRecipeSwap();
                _simState = _cloneSimState(_bestSimState);
                var postQty = _climbQuantityRedistribute();
                improved.postQty = postRecipe || postSwap || postQty;
            });
        }
        {
            steps.push(function() {
                _simState = _cloneSimState(_bestSimState);
                improved.lowQty = _climbLowQtyRecipeReplaceLite();
                if (improved.lowQty) {
                    _simState = _cloneSimState(_bestSimState);
                    improved.lowQty = _climbQuantityRedistribute() || improved.lowQty;
                }
            });
        }
        if (round === 1) {
            steps.push(function() {
                _simState = _cloneSimState(_bestSimState);
                improved.rebuild = _positionRebuildLite();
            });
        }

        function finishRound() {
            if (_newbieEquipEnabled) {
                _simState = _cloneSimState(_bestSimState);
                improved.newbieEquip = _fitNewbieEquipsForCurrentState();
                if (improved.newbieEquip) {
                    _bestScore = _calcScore();
                    _bestSimState = _cloneSimState(_simState);
                }
            }
            if (_isTargetReached()) {
                if (typeof onDone === 'function') onDone();
                return;
            }
            var anyImproved = improved.chef || improved.dualChef || improved.swap || improved.recipe || improved.recipeSwap || improved.joint || improved.reselect || improved.reInject || improved.quantity || improved.postQty || improved.lowQty || improved.rebuild || improved.newbieEquip;
            var labels = [];
            if (improved.chef) labels.push('厨师');
            if (improved.dualChef) labels.push('双厨替');
            if (improved.swap) labels.push('厨交');
            if (improved.recipe) labels.push('菜谱');
            if (improved.recipeSwap) labels.push('菜交');
            if (improved.joint) labels.push('联合');
            if (improved.reselect) labels.push('重选/重建');
            if (improved.reInject) labels.push('RE注');
            if (improved.quantity) labels.push('份数');
            if (improved.postQty) labels.push('份数后补搜');
            if (improved.lowQty) labels.push('低份替');
            if (improved.rebuild) labels.push('位置重建');
            if (improved.newbieEquip) labels.push('新手厨具');
            console.log('[厨神大赛-简化版] 爬山R' + (round + 1) + ': ' + (labels.length ? labels.join('+') : '无改进') + ' ' + roundStartScore + '→' + _bestScore + ' ' + ((Date.now() - roundStart) / 1000).toFixed(1) + 's');
            if (!anyImproved || round + 1 >= CONFIG.maxRounds) {
                if (typeof onDone === 'function') onDone();
                return;
            }
            setTimeout(function() { _runClimbingPhase(round + 1, onDone, 0); }, 2);
        }

        function runStep(index) {
            if (index >= steps.length) {
                finishRound();
                return;
            }
            setTimeout(function() {
                steps[index]();
                runStep(index + 1);
            }, 0);
        }

        runStep(0);
    }

    function optimize(targetScore, onProgress, onComplete, options) {
        options = options || {};
        _targetScore = targetScore && targetScore > 0 ? targetScore : null;

        if (_isRunning) {
            if (typeof onComplete === 'function') onComplete({ success: false, score: 0, message: '正在运行' });
            return;
        }
        if (!_rule) {
            if (typeof onComplete === 'function') onComplete({ success: false, score: 0, message: '未初始化' });
            return;
        }

        _isRunning = true;
        _bestSimState = null;
        _bestScore = 0;
        _bestSeedSource = '';
        _progressTarget = 0;
        _progressDisplayScore = 0;
        _progressFeasibleBest = 0;
        _progressFeasibleState = null;
        _topCandidates = [];
        Top10Manager.clear();

        _onProgress = onProgress || null;
        if (_onProgress) _onProgress({ progress: 0, score: 0 });
        _startProgressTimer();

        var startTime = Date.now();
        setTimeout(function() {
            try {
                _generateInitialSolution(function() {
                    try {
                        _setProgressTarget(10);
                        if (_isTargetReached()) {
                            _finishOptimization(onComplete, startTime);
                            return;
                        }

                        var totalSeeds = Math.min(_singleTrio ? 2 : 5, _topCandidates.length);
                        var seedBuckets = {};
                        var perChefTrioKeep = _singleTrio ? 2 : 1;

                        for (var di = 0; di < _topCandidates.length; di++) {
                            var dc = _topCandidates[di];
                            var chefKey = _getStateChefKey(dc.state, false);
                            var recipeKey = _getStateRecipeSignature(dc.state, false);
                            if (!seedBuckets[chefKey]) seedBuckets[chefKey] = { map: {} };
                            var bucket = seedBuckets[chefKey];
                            var existed = bucket.map[recipeKey];
                            if (!existed || dc.score > existed.score) bucket.map[recipeKey] = dc;
                        }

                        var dedupedCandidates = [];
                        for (var bkey in seedBuckets) {
                            var bucketList = [];
                            var bucketMap = seedBuckets[bkey].map;
                            for (var rkey in bucketMap) bucketList.push(bucketMap[rkey]);
                            bucketList.sort(function(a, b) { return b.score - a.score; });
                            for (var bi = 0; bi < bucketList.length && bi < perChefTrioKeep; bi++) {
                                dedupedCandidates.push(bucketList[bi]);
                            }
                        }

                        if (dedupedCandidates.length <= 2 && _topCandidates.length > dedupedCandidates.length) {
                            var recipeDedup = {};
                            var recipeDedupCandidates = [];
                            for (var di2 = 0; di2 < _topCandidates.length; di2++) {
                                var dc2 = _topCandidates[di2];
                                var rkey2 = _getStateRecipeSignature(dc2.state, false);
                                if (!recipeDedup[rkey2] || dc2.score > recipeDedup[rkey2].score) recipeDedup[rkey2] = dc2;
                            }
                            for (var rdKey in recipeDedup) recipeDedupCandidates.push(recipeDedup[rdKey]);
                            recipeDedupCandidates.sort(function(a, b) { return b.score - a.score; });
                            dedupedCandidates = recipeDedupCandidates;
                            console.log('[厨神大赛] 去重后种子过少，回退全局菜谱去重: ' + dedupedCandidates.length + '个');
                        }

                        dedupedCandidates.sort(function(a, b) { return b.score - a.score; });
                        _topCandidates = dedupedCandidates;
                        if (_singleTrio) {
                            var selectedSingleTrioSeeds = _selectSingleTrioSearchCandidates(_topCandidates, totalSeeds);
                            if (selectedSingleTrioSeeds.length > 0) _topCandidates = selectedSingleTrioSeeds;
                        }
                        totalSeeds = Math.min(totalSeeds, _topCandidates.length);
                        console.log('[厨神大赛] 种子去重后: ' + _topCandidates.length + '个, 搜索' + totalSeeds + '个');

                        var seedIdx = 0;
                        var convergenceCount = 0;
                        var globalBestChefKey = '';
                        var globalBestScore = _bestScore;
                        var globalBestState = _cloneSimState(_bestSimState);
                        var globalBestSource = _topCandidates.length ? _topCandidates[0].source : '';

                        function runSeed() {
                            if (seedIdx >= totalSeeds) {
                                _bestScore = globalBestScore;
                                _bestSimState = globalBestState;
                                _bestSeedSource = globalBestSource;
                                _simState = _cloneSimState(_bestSimState);
                                _finishOptimization(onComplete, startTime);
                                return;
                            }

                            var seed = _topCandidates[seedIdx];
                            seedIdx++;

                            if (seedIdx > 2 && seed.score < globalBestScore * 0.50) {
                                console.log('[厨神大赛] 跳过低分种子: ' + seed.source + ' 分数=' + seed.score);
                                _setProgressTarget(Math.floor(10 + 80 * seedIdx / Math.max(totalSeeds, 1)));
                                setTimeout(runSeed, 2);
                                return;
                            }

                            _bestScore = seed.score;
                            _bestSimState = _cloneSimState(seed.state);
                            _simState = _cloneSimState(_bestSimState);
                            _preRestartBestScore = 0;
                            _preRestartBestState = null;
                            _restartedSeedIndices = {};
                            var seedSearchStart = Date.now();
                            console.log('[厨神大赛] 搜索种子 ' + seedIdx + '/' + totalSeeds + ': ' + seed.source + ' 初始分=' + seed.score);

                            _runClimbingPhase(0, function() {
                                _simState = _cloneSimState(_bestSimState);
                                if (_newbieEquipEnabled) {
                                    _fitNewbieEquipsForCurrentState();
                                    _bestScore = _calcScore();
                                    _bestSimState = _cloneSimState(_simState);
                                }
                                _fixSkillInvalidRecipes();
                                if (!_checkGlobalMaterialFeasible()) _fixGlobalMaterialOverflow();
                                _normalizeBestState('种子搜索完成');
                                _simState = _cloneSimState(_bestSimState);
                                var finalSeedScore = _calcScore();
                                _bestScore = finalSeedScore;
                                _bestSimState = _cloneSimState(_simState);

                                console.log('[厨神大赛] 种子 ' + seed.source + ' 最终分=' + _bestScore + ' 耗时=' + ((Date.now() - seedSearchStart) / 1000).toFixed(1) + 's' + (_bestScore > seed.score ? ' (+' + (_bestScore - seed.score) + ')' : ''));
                                if (_bestScore > globalBestScore) {
                                    globalBestScore = _bestScore;
                                    globalBestState = _cloneSimState(_bestSimState);
                                    globalBestSource = seed.source;
                                    _updateProgressBest(globalBestScore, globalBestState);
                                    convergenceCount = 0;
                                    globalBestChefKey = _getStateChefKey(globalBestState, false);
                                } else {
                                    if (_singleTrio) {
                                        convergenceCount++;
                                    } else {
                                        var seedChefKey = _getStateChefKey(_bestSimState, false);
                                        if (globalBestChefKey === '') globalBestChefKey = _getStateChefKey(globalBestState, false);
                                        if (seedChefKey === globalBestChefKey && _bestScore >= globalBestScore * 0.95) {
                                            convergenceCount++;
                                        } else {
                                            convergenceCount = 0;
                                            globalBestChefKey = _getStateChefKey(globalBestState, false);
                                        }
                                    }
                                }
                                if (_isTargetReached()) {
                                    _bestSeedSource = globalBestSource;
                                    _bestScore = globalBestScore;
                                    _bestSimState = globalBestState;
                                    _simState = _cloneSimState(_bestSimState);
                                    _finishOptimization(onComplete, startTime);
                                    return;
                                }
                                if (convergenceCount >= 20) {
                                    console.log('[厨神大赛] 连续' + convergenceCount + '个种子收敛，提前结束');
                                    _bestSeedSource = globalBestSource;
                                    _bestScore = globalBestScore;
                                    _bestSimState = globalBestState;
                                    _simState = _cloneSimState(_bestSimState);
                                    _finishOptimization(onComplete, startTime);
                                    return;
                                }
                                _setProgressTarget(Math.floor(10 + 80 * seedIdx / Math.max(totalSeeds, 1)));
                                setTimeout(runSeed, 2);
                            });
                        }

                        setTimeout(runSeed, 2);
                    } catch (e) {
                        console.error('[厨神大赛] 搜索阶段异常:', e);
                        _isRunning = false;
                        _stopProgressTimer();
                        if (typeof onComplete === 'function') onComplete({ success: false, score: 0, message: '搜索异常: ' + e.message });
                    }
                });
            } catch (e) {
                console.error('[厨神大赛] 种子生成异常:', e);
                _isRunning = false;
                _stopProgressTimer();
                if (typeof onComplete === 'function') onComplete({ success: false, score: 0, message: '种子生成异常: ' + e.message });
            }
        }, 10);
    }

    function _finishOptimization(onComplete, startTime) {
        if (!_isRunning) return;

        if (_progressTimer) {
            clearInterval(_progressTimer);
            _progressTimer = null;
        }

        var memTotal = 0;
        if (_bestSimState) {
            _simState = _cloneSimState(_bestSimState);
            if (_newbieEquipEnabled) {
                _fitNewbieEquipsForCurrentState();
            }
            var usedChefIds = {};
            for (var ci = 0; ci < 3; ci++) if (_simState[0][ci].chefId) usedChefIds[_simState[0][ci].chefId] = true;
            for (var fillCi = 0; fillCi < 3; fillCi++) {
                if (_simState[0][fillCi].chefId) continue;
                var chefRk = _fastGetChefRanking(fillCi, true);
                for (var j = 0; j < chefRk.length; j++) {
                    if (usedChefIds[chefRk[j].chefId]) continue;
                    _simSetChef(fillCi, chefRk[j].chefId);
                    usedChefIds[chefRk[j].chefId] = true;
                    for (var reci = 0; reci < 3; reci++) {
                        _simState[0][fillCi].recipes[reci] = {data: null, quantity: 0, max: 0};
                        var rk = _fastGetRecipeRanking(fillCi, reci, 1, true);
                        if (rk.length > 0) _simSetRecipe(fillCi, reci, rk[0].recipeId);
                    }
                    break;
                }
            }

            _normalizeBestState('简化版最终收尾');
            _simState = _cloneSimState(_bestSimState);
            _syncRecipeDataFromMenus();
            _applyChefData();
            if (!_checkGlobalMaterialFeasible()) _fixGlobalMaterialOverflow();
            memTotal = _calcScore();
            _bestScore = memTotal;
            _bestSimState = _cloneSimState(_simState);
            _applySimStateToSystem(_simState);
        }

        var totalTime = Date.now() - (startTime || Date.now());
        var finalScore = 0;
        if (typeof calCustomResults === 'function') calCustomResults(_gameData);
        finalScore = (typeof calCustomRule !== 'undefined' && calCustomRule) ? (calCustomRule.score || 0) : _bestScore;
        _bestScore = finalScore;
        _logFinalCombination();

        var passLineResult = '';
        if (_rule.PassLine && finalScore) {
            var passLine = _rule.PassLine;
            var tips = passLine.length === 3 ? ['高保', '中保', '低保'] : (passLine.length === 4 ? ['高保', '中保', '低保', '未达标'] : ['过线', '未过线']);
            var idx = passLine.length;
            for (var pi = 0; pi < passLine.length; pi++) { if (finalScore >= passLine[pi]) { idx = pi; break; } }
            passLineResult = tips[idx] || '';
        }

        console.log('[厨神大赛] 优化完成: 分数=' + finalScore + (passLineResult ? ' ' + passLineResult : '') + ' 最佳种子=' + _bestSeedSource + ' 耗时=' + (totalTime / 1000).toFixed(1) + '秒');
        _stopProgressTimer(finalScore);

        _bestResult = { score: finalScore, passLine: passLineResult };
        _isRunning = false;
        if (typeof onComplete === 'function') onComplete({ success: true, score: finalScore, passLine: passLineResult, timeMs: totalTime, message: '优化完成' });

        _simState = null;
        _bestSimState = null;
        _topCandidates = [];
        _chefMap = {};
        _recipeMap = {};
        _menus = [];
        _rule = null;
        _gameData = null;
        _cachedConfig = {};
        _materialsAll = null;
        _availableEquips = [];
        _progressFeasibleState = null;
        _preRestartBestScore = 0;
        _preRestartBestState = null;
        _restartedSeedIndices = {};
    }

    function isRunning() { return _isRunning; }
    function getBestResult() { return _bestResult; }

    return {
        init: init,
        optimize: optimize,
        isRunning: isRunning,
        getBestResult: getBestResult,
        applyResult: applyResult,
        Top10Manager: Top10Manager,
        _applySimStateToSystem: _applySimStateToSystem,
        _chefMap: function() { return _chefMap; },
        supportsTop10: false,
        isSimpleDefault: true
    };
})();

window.DefaultCompetitionOptimizer = DefaultCompetitionOptimizer;
window.restoreDefaultCompetitionOptimizer = function() {
    window.CompetitionOptimizer = window.DefaultCompetitionOptimizer;
};
if (typeof window.CompetitionOptimizer === 'undefined') {
    window.CompetitionOptimizer = window.DefaultCompetitionOptimizer;
}
