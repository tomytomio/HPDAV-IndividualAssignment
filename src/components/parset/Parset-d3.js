import * as d3 from 'd3';

class ParsetD3 {
    margin = {top: 20, right: 20, bottom: 20, left: 20};
    
    constructor(el){
        this.el = el;
        this.svg = null;
        this.width = 800;
        this.height = 400;
        this.rectW = 6; // width of the category bars
        this.categoryGap = 2;
        this.order = {}; // stores custom category ordering when user drags them
        this.minCategoryRatio = 0.01; // small categories get grouped into 'Others'
        this._lastSelectionHash = null; // need this to detect selection changes without re-rendering every time
    }

    normalize(v){
        // convert everything to strings, handle nulls/bools properly
        if (v === true || v === false) return String(v);
        if (v === null || v === undefined || v === '') return 'NA';
        return String(v);
    }

    clear(){
        d3.select(this.el).selectAll("*").remove();
    }

    create(config){
        const w = config?.size?.width;
        const h = config?.size?.height;
        const safeW = Number.isFinite(w) ? w : this.width;
        const safeH = Number.isFinite(h) ? h : this.height;
        this.size = {width: safeW, height: safeH};
        this.width = Math.max(0, (this.size.width || 0) - this.margin.left - this.margin.right);
        this.height = Math.max(0, (this.size.height || 0) - this.margin.top - this.margin.bottom);

        this.svg = d3.select(this.el).append('svg')
            .attr('width', this.width + this.margin.left + this.margin.right)
            .attr('height', this.height + this.margin.top + this.margin.bottom)
            .append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`)
            .attr('class','parset-g');
    }

    computeLayout(data, axes, selected = null){
        if (!axes || axes.length === 0) {
            return {nodes: {}, paths: [], total: data ? data.length : 0};
        }
        const nodes = {};
        const total = data.length;

        // check if a ribbon should be highlighted based on current selection
        const matchesSelection = (path) => {
            if (!selected) return false;
            const effSelectedEntries = Object.entries(selected).filter(([a,s])=> axes.includes(a) && s && s.size>0);
            if (effSelectedEntries.length === 0) return false;
            for (const [a, s] of effSelectedEntries){
                if (!s.has(path.byAttr[a])) return false;
            }
            return true;
        };

        const normalize = this.normalize;

        // step 1: count categories per axis
        const categoryMaps = {};
        const catMapping = {};
        const threshold = Math.max(1, Math.floor(this.minCategoryRatio * total));
        
        axes.forEach((attr) => {
            const map = new Map();
            data.forEach(d => {
                const v = normalize(d[attr]);
                if (!map.has(v)) map.set(v, {key: v, count: 0, items: []});
                const entry = map.get(v);
                entry.count += 1;
                entry.items.push(d.index);
            });
            categoryMaps[attr] = map;

            // group small categories into 'Others' to avoid clutter
            const mapping = new Map();
            let othersCount = 0; let othersItems = [];
            map.forEach((val, key) => {
                if (val.count < threshold) {
                    mapping.set(key, 'Others');
                    othersCount += val.count;
                    othersItems = othersItems.concat(val.items);
                } else {
                    mapping.set(key, key);
                }
            });
            catMapping[attr] = mapping;
        });

        // step 2: build final categories (after merging small ones)
        axes.forEach((attr) => {
            const map = categoryMaps[attr];
            const mapping = catMapping[attr];
            const agg = new Map();

            map.forEach((v, key) => {
                const mkey = mapping.get(key) || key;
                if (!agg.has(mkey)) agg.set(mkey, {key: mkey, count: 0, items: []});
                const e = agg.get(mkey);
                e.count += v.count;
                e.items = e.items.concat(v.items);
            });

            // sort by saved order if exists, otherwise by count
            const cats = Array.from(agg.values());
            const saved = this.order && this.order[attr] ? this.order[attr] : null;
            if (saved) {
                cats.sort((a,b)=>{
                    if (a.key === 'Others' && b.key !== 'Others') return 1;
                    if (b.key === 'Others' && a.key !== 'Others') return -1;
                    const ia = saved.indexOf(a.key);
                    const ib = saved.indexOf(b.key);
                    if (ia === -1 && ib === -1) return b.count - a.count;
                    if (ia === -1) return 1;
                    if (ib === -1) return -1;
                    return ia - ib;
                });
            } else {
                cats.sort((a,b) => {
                    if (a.key === 'Others' && b.key !== 'Others') return 1;
                    if (b.key === 'Others' && a.key !== 'Others') return -1;
                    return b.count - a.count;
                });
            }

            // position categories vertically, leave room for axis labels at top
            let yPos = 35;
            cats.forEach(cat => {
                cat.y = yPos;
                cat.h = (cat.count / total) * (this.height - 35);
                yPos += cat.h;
            });
            nodes[attr] = {attr, cats};
        });

        // build index map for quick lookups
        const indexOrder = {};
        axes.forEach(attr => {
            const m = new Map();
            nodes[attr].cats.forEach((c, j)=> m.set(c.key, j));
            indexOrder[attr] = m;
        });

        // step 3: create paths (ribbons) connecting categories
        const pathMap = new Map();
        data.forEach(d => {
            const values = axes.map(a => {
                const raw = normalize(d[a]);
                const mapped = (catMapping[a] && catMapping[a].get(raw)) || raw;
                return mapped;
            });
            const key = values.join('||');
            if (!pathMap.has(key)) {
                const byAttr = {};
                axes.forEach((a, i) => byAttr[a] = values[i]);
                pathMap.set(key, { key, values, byAttr, count: 0, items: [] });
            }
            const p = pathMap.get(key);
            p.count += 1;
            p.items.push(d.index);
        });

        // sort paths for consistent rendering
        const paths = Array.from(pathMap.values()).sort((p1, p2) => {
            for (let i=0; i<axes.length; i++){
                const c = p1.values[i].localeCompare(p2.values[i]);
                if (c !== 0) return c;
            }
            return p2.count - p1.count;
        });

        // step 4: calculate ribbon heights and positions
    const heightFactor = (this.height - 35) / (total || 1);
    const segLen = Math.max(0, axes.length - 1);
    paths.forEach(p => { p.h = p.count * heightFactor; p.seg = new Array(segLen).fill(null); });

        const baseY = {};
        axes.forEach(attr => {
            const m = new Map();
            nodes[attr].cats.forEach(c => m.set(c.key, c.y));
            baseY[attr] = m;
        });

        for (let i=0; i<axes.length-1; i++){
            const aSrc = axes[i];
            const aTgt = axes[i+1];

            // stack ribbons on source side
            const bySource = new Map();
            paths.forEach(p => {
                const s = p.values[i];
                if (!bySource.has(s)) bySource.set(s, []);
                bySource.get(s).push(p);
            });
            const srcOffsets = new Map();
            nodes[aSrc].cats.forEach(c => srcOffsets.set(c.key, baseY[aSrc].get(c.key)));
            bySource.forEach((plist, sKey) => {
                // put selected ribbons on top, then sort by target position
                plist.sort((a,b)=>{
                    const aSelected = matchesSelection(a);
                    const bSelected = matchesSelection(b);
                    if (aSelected && !bSelected) return -1;
                    if (!aSelected && bSelected) return 1;
                    
                    const at = a.values[i+1];
                    const bt = b.values[i+1];
                    const ia = indexOrder[aTgt].get(at) ?? 0;
                    const ib = indexOrder[aTgt].get(bt) ?? 0;
                    if (ia !== ib) return ia - ib;
                    return b.count - a.count;
                });
                let cur = srcOffsets.get(sKey) ?? baseY[aSrc].get(sKey) ?? 0;
                plist.forEach(p => {
                    if (!p.seg[i]) p.seg[i] = {};
                    p.seg[i].ySource = cur;
                    cur += p.h;
                });
                srcOffsets.set(sKey, cur);
            });

            // stack ribbons on target side
            const byTarget = new Map();
            paths.forEach(p => {
                const t = p.values[i+1];
                if (!byTarget.has(t)) byTarget.set(t, []);
                byTarget.get(t).push(p);
            });
            const tgtOffsets = new Map();
            nodes[aTgt].cats.forEach(c => tgtOffsets.set(c.key, baseY[aTgt].get(c.key)));
            byTarget.forEach((plist, tKey) => {
                // same thing - selected first, then sort by source position
                plist.sort((a,b)=>{
                    const aSelected = matchesSelection(a);
                    const bSelected = matchesSelection(b);
                    if (aSelected && !bSelected) return -1;
                    if (!aSelected && bSelected) return 1;
                    
                    const as = a.values[i];
                    const bs = b.values[i];
                    const ia = indexOrder[aSrc].get(as) ?? 0;
                    const ib = indexOrder[aSrc].get(bs) ?? 0;
                    if (ia !== ib) return ia - ib;
                    return b.count - a.count;
                });
                let cur = tgtOffsets.get(tKey) ?? baseY[aTgt].get(tKey) ?? 0;
                plist.forEach(p => {
                    if (!p.seg[i]) p.seg[i] = {};
                    p.seg[i].yTarget = cur;
                    cur += p.h;
                });
                tgtOffsets.set(tKey, cur);
            });
        }

        return {nodes, paths, total, indexOrder};
    }

    render(data, axes, state){
        if (!data || data.length === 0 || !axes || axes.length === 0 || !this.svg) return;
        
        // cache these for re-renders after drag
        this._data = data; this._axes = axes; this._state = state;
        
        // use React order if provided, keeps things consistent
        if (state && state.order && Object.keys(state.order).length > 0) {
            this.order = {...this.order, ...state.order};
        }

        // auto-reorganize when selection changes to group selected ribbons together
        const selectionHash = JSON.stringify(state.selected || {});
        const hasSelection = state.selected && Object.keys(state.selected).some(k => state.selected[k] && state.selected[k].size > 0);
        if (hasSelection && selectionHash !== this._lastSelectionHash) {
            this._lastSelectionHash = selectionHash;
            this.reorganizeForSelection(data, axes, state);
            // continue rendering with new order
        } else if (!hasSelection && this._lastSelectionHash !== null) {
            this._lastSelectionHash = null;
        }

        const layout = this.computeLayout(data, axes, state?.selected);

        // figure out horizontal positions for each axis
        const axisCount = axes.length;
        const width = Number.isFinite(this.width) ? this.width : 0;
        const gap = (axisCount>1) ? ((width - 40)/(axisCount-1)) : width/2;
        const xPositions = Array.from({length: axisCount}, (_, i)=> i*gap);
        const x = (i) => {
            const v = xPositions[i];
            return Number.isFinite(v) ? v : 0;
        };

        // draw the axes
        const axisG = this.svg.selectAll('.axisG')
            .data(axes, d=>d)
            .join(enter=>enter.append('g').attr('class','axisG'))
            .attr('transform', (d,i) => `translate(${x(i)},0)`);

        // axis titles - alternate height so they don't overlap
        const rectW = this.rectW;
        axisG.each(function(attr, axisIndex) {
            d3.select(this).selectAll('text.axisTitle')
                .data([attr])
                .join('text')
                .attr('class','axisTitle')
                .attr('x', rectW / 2)
                .attr('y', (axisIndex % 2 === 0) ? 25 : 10) // even lower, odd higher
                .attr('text-anchor', 'middle')
                .text(d=>d);
        });

        // draw category boxes for each axis
        axisG.each((attr, i, nodesSel) => {
            const node = layout.nodes[attr];
            if (!node) return;

            const g = d3.select(nodesSel[i]);
            const cats = g.selectAll('.cat')
                .data(node.cats, d=>d.key)
                .join(enter=>{
                    const eg = enter.append('g').attr('class','cat');
                    eg.append('rect').attr('class','catRect');
                    eg.append('text').attr('class','catLabel');
                    return eg;
                });

            cats.attr('transform', d=>`translate(0,${Number.isFinite(d.y) ? d.y : 0})`)
                .select('rect.catRect')
                .attr('width', this.rectW)
                .attr('height', d=>Math.max(1, d.h - this.categoryGap))
                .attr('fill', d=> state.selected && state.selected[attr] && state.selected[attr].has(d.key) ? '#ff7f0e' : '#69b3a2')
                .attr('stroke','none')
                .attr('opacity', d=> d.count===0?0.2:1);

            // labels - first axis gets left-aligned so it doesn't overlap
            cats.select('text.catLabel')
                .attr('x', d => (i === 0 ? this.rectW + 6 : this.rectW / 2))
                .attr('y', d=> Math.max(10, d.h/2))
                .attr('dy', '0.35em')
                .attr('text-anchor', i === 0 ? 'start' : 'middle')
                .text(d=>`${d.key} (${d.count})`)
                .style('font-size','12px')
                .style('pointer-events', 'none');

            // drag to reorder categories
            let dragStartY = 0;
            let hasMoved = false;
            
            const that = this;
            cats.call(
                d3.drag()
                .on('start', function(event, d){ 
                    hasMoved = false;
                    dragStartY = event.y;
                    d._originalY = d.y;
                    d3.select(this).classed('dragging', true)
                        .raise();
                })
                .on('drag', function(event, d){
                    if (Math.abs(event.y - dragStartY) > 3) {
                        hasMoved = true;
                    }
                    const ny = Math.max(0, Math.min(that.height - d.h, d._originalY + (event.y - dragStartY)));
                    d._ny = ny;
                    d3.select(this).attr('transform', `translate(0,${ny})`);
                })
                .on('end', function(event, d){
                    d3.select(this).classed('dragging', false);
                    
                    if (hasMoved && d._ny != null) {
                        // figure out new order based on where we dropped it
                        const temp = node.cats.map(c => ({
                            key: c.key,
                            originalY: c.y,
                            newY: (c === d) ? d._ny : c.y,
                            centerY: (c === d) ? (d._ny + d.h/2) : (c.y + c.h/2)
                        }));
                        
                        temp.sort((a,b)=> a.centerY - b.centerY);
                        
                        that.order = that.order || {};
                        that.order[attr] = temp.map(c => c.key);
                        
                        if (that._state && typeof that._state.onOrderChanged === 'function') {
                            that._state.onOrderChanged({[attr]: that.order[attr]});
                        }
                        // re-render
                        that.render(that._data, that._axes, that._state);
                    } else {
                        // snap back if not moved enough
                        d3.select(this).attr('transform', `translate(0,${d.y})`);
                    }
                    
                    delete d._ny;
                    delete d._originalY;
                    hasMoved = false;
                })
            );

            // click to select/deselect categories
            cats.select('rect.catRect')
                .style('cursor', 'move')
                .on('click', function(event, d){
                    event.stopPropagation();
                    // small delay to avoid triggering selection after drag
                    setTimeout(() => {
                        if (!hasMoved && state.onToggle) {
                            state.onToggle(attr, d.key);
                        }
                    }, 10);
                });
        });

        // draw ribbons connecting the axes
        const linksLayer = this.svg.selectAll('.linksLayer')
            .data([null])
            .join('g')
            .attr('class', 'linksLayer');

        // figure out which ribbons match current selection
        const effSelectedEntries = state.selected ? Object.entries(state.selected).filter(([a,s])=> axes.includes(a) && s && s.size>0) : [];
        const hasActiveSelection = effSelectedEntries.length>0;
        const matchesSelection = (path) => {
            if (!hasActiveSelection) return false;
            for (const [a, s] of effSelectedEntries){
                if (!s.has(path.byAttr[a])) return false;
            }
            return true;
        };

        // create groups for each segment index
        const indices = Array.from({length: Math.max(0, axes.length-1)}, (_,i)=>i);
        const groups = linksLayer.selectAll('g.linkG')
            .data(indices, d=>d)
            .join(
                enter => enter.append('g').attr('class','linkG'),
                update => update,
                exit => exit.remove()
            )
            .attr('class', d => `linkG linkG-${d}`);

        groups.each((segIndex, i, nodesSel) => {
            const g = d3.select(nodesSel[i]);
            const segs = g.selectAll('path.link')
                .data(layout.paths, d => d.key)
                .join(
                    enter => enter.append('path').attr('class','link'),
                    update => update,
                    exit => exit.remove()
                );

            // draw straight-ish ribbons on top (sort by alignment)
            const idxSrc = layout.indexOrder[axes[segIndex]];
            const idxTgt = layout.indexOrder[axes[segIndex+1]];
            segs.sort((a,b)=>{
                const as = idxSrc.get(a.values[segIndex]) ?? 0;
                const at = idxTgt.get(a.values[segIndex+1]) ?? 0;
                const bs = idxSrc.get(b.values[segIndex]) ?? 0;
                const bt = idxTgt.get(b.values[segIndex+1]) ?? 0;
                const da = Math.abs(as - at);
                const db = Math.abs(bs - bt);
                return db - da; // bigger diff first, smaller on top
            });

            segs
                .attr('d', d => {
                    const seg = d.seg[segIndex] || {};
                    const y1 = seg.ySource ?? 0;
                    const y2 = seg.yTarget ?? 0;
                    const h = d.h;
                    const x1 = x(segIndex) + this.rectW;
                    const x2 = x(segIndex+1);

                    const cp1x = x1 + (x2 - x1) * 0.25;
                    const cp2x = x1 + (x2 - x1) * 0.75;

                    return `M${x1},${y1}
                            C${cp1x},${y1} ${cp2x},${y2} ${x2},${y2}
                            L${x2},${y2+h}
                            C${cp2x},${y2+h} ${cp1x},${y1+h} ${x1},${y1+h}
                            Z`;
                })
                .attr('fill', d => (hasActiveSelection && matchesSelection(d)) ? '#ff7f0e' : '#1f77b4')
                .attr('opacity', d => (hasActiveSelection && matchesSelection(d)) ? 0.7 : (hasActiveSelection ? 0.15 : 0.45));
        });
    }

    // auto-arrange categories to minimize ribbon crossings
    autoArrange(options={}){
        if (!this._data || !this._axes || this._axes.length < 2) return;
        const axes = this._axes.slice();
        const layout = this.computeLayout(this._data, axes, this._state?.selected);
        if (!layout) return;

        // keep current orders as starting point
        const orderMap = {...(this.order || {})};

        // helper to build index lookups
        const buildIdxMap = (ordMap) => {
            const idx = {};
            axes.forEach(a => {
                const baseOrder = (ordMap[a] && ordMap[a].length)
                    ? ordMap[a]
                    : layout.nodes[a].cats.map(c => c.key);
                idx[a] = new Map(baseOrder.map((k, j)=>[k, j]));
            });
            return idx;
        };

        // barycenter: reorder one axis based on neighbor positions
        const reorderToward = (axisIndex, towardRight, idxMap) => {
            const a = axes[axisIndex];
            const neighborIndex = towardRight ? axisIndex+1 : axisIndex-1;
            if (neighborIndex < 0 || neighborIndex >= axes.length) return;
            const b = axes[neighborIndex];
            const idxB = idxMap[b];

            // use current order as tiebreaker
            const currentOrderA = (orderMap[a] && orderMap[a].length)
                ? orderMap[a]
                : layout.nodes[a].cats.map(c => c.key);
            const curIdxA = new Map(currentOrderA.map((k,j)=>[k,j]));

            const avgIndex = new Map();
            const weightSum = new Map();

            // compute weighted average of neighbor positions
            layout.paths.forEach(p => {
                const src = p.values[axisIndex];
                const tgt = p.values[neighborIndex];
                const w = p.count || 0;
                const tIdx = idxB.get(tgt);
                const neighborPos = (tIdx !== undefined) ? tIdx : Number.MAX_SAFE_INTEGER;
                avgIndex.set(src, (avgIndex.get(src) || 0) + w * neighborPos);
                weightSum.set(src, (weightSum.get(src) || 0) + w);
            });

            const catsA = Array.from(new Set(currentOrderA.concat(layout.nodes[a].cats.map(c=>c.key))));
            const scored = catsA.map(k => {
                const w = weightSum.get(k) || 0;
                const s = avgIndex.get(k) || 0;
                const avg = w > 0 ? (s / w) : Number.MAX_SAFE_INTEGER;
                return {key:k, avg, tie: curIdxA.get(k) ?? Number.MAX_SAFE_INTEGER};
            });

            scored.sort((x,y)=> (x.avg - y.avg) || (x.tie - y.tie));
            orderMap[a] = scored.map(d => d.key);
        };

        // do multiple passes, alternating left-right and right-left
        const iters = Math.max(1, Math.min(6, options.iterations || 3));
        for (let iter=0; iter<iters; iter++){
            let idxMap = buildIdxMap(orderMap);
            
            for (let i=1; i<axes.length; i++){
                reorderToward(i, false, idxMap);
                idxMap = buildIdxMap(orderMap);
            }
            
            for (let i=axes.length-2; i>=0; i--){
                reorderToward(i, true, idxMap);
                idxMap = buildIdxMap(orderMap);
            }
        }

        this.order = orderMap;
        
        if (this._state && typeof this._state.onOrderChanged === 'function') {
            this._state.onOrderChanged(orderMap);
        }
        this.render(this._data, this._axes, this._state);
    }

    // reorder categories to group selected ribbons together
    reorganizeForSelection(data, axes, state){
        if (!state || !state.selected || axes.length < 2) return;
        const layout = this.computeLayout(data, axes, state.selected);
        if (!layout) return;

        // check which ribbons are selected
        const effSelectedEntries = Object.entries(state.selected).filter(([a,s])=> axes.includes(a) && s && s.size>0);
        const hasActiveSelection = effSelectedEntries.length>0;
        if (!hasActiveSelection) return;

        const matchesSelection = (path) => {
            for (const [a, s] of effSelectedEntries){
                if (!s.has(path.byAttr[a])) return false;
            }
            return true;
        };

        const orderMap = {...(this.order || {})};

        const getCurrentOrder = (attr) => {
            return (orderMap[attr] && orderMap[attr].length)
                ? orderMap[attr]
                : layout.nodes[attr].cats.map(c => c.key);
        };

        // reorder each axis to group similar patterns
        axes.forEach((attr, axisIndex) => {
            const currentOrder = getCurrentOrder(attr);
            
            // for each category, see what it connects to
            const categoryInfo = currentOrder.map((catKey, originalIndex) => {
                const touching = layout.paths.filter(p => p.values[axisIndex] === catKey);
                const selectedTouching = touching.filter(matchesSelection);

                if (selectedTouching.length === 0) {
                    return {
                        key: catKey,
                        originalIndex,
                        hasSelected: false,
                        connections: []
                    };
                }

                // track what this category connects to on left/right
                const connections = selectedTouching.map(p => {
                    const left = axisIndex > 0 ? p.values[axisIndex - 1] : '';
                    const right = axisIndex < axes.length - 1 ? p.values[axisIndex + 1] : '';
                    return `${left}→${right}`;
                }).sort();

                return {
                    key: catKey,
                    originalIndex,
                    hasSelected: true,
                    connections, // array of connection signatures
                    primaryConnection: connections[0] || '', // use first as primary for grouping
                    count: selectedTouching.reduce((s,p)=>s+p.count, 0)
                };
            });

            // Sort to group categories with same connection patterns together
            // while maintaining relative position for categories without changes
            categoryInfo.sort((a, b) => {
                // If neither has selected ribbons, keep original order
                if (!a.hasSelected && !b.hasSelected) {
                    return a.originalIndex - b.originalIndex;
                }

                // Mix of selected and non-selected: keep original order
                // (don't push selected to top or bottom)
                if (a.hasSelected !== b.hasSelected) {
                    return a.originalIndex - b.originalIndex;
                }

                // Both have selected ribbons: group by connection pattern
                if (a.hasSelected && b.hasSelected) {
                    // Group by primary connection signature
                    const connCmp = a.primaryConnection.localeCompare(b.primaryConnection);
                    if (connCmp !== 0) return connCmp;
                    
                    // Within same connection group: maintain original order for stability
                    return a.originalIndex - b.originalIndex;
                }

                return a.originalIndex - b.originalIndex;
            });

            orderMap[attr] = categoryInfo.map(d => d.key);
        });

        this.order = orderMap;
        // Don't notify host here - let the reorganization happen silently without triggering React state update
        // The order will be used in the immediate re-render below
    }
}

export default ParsetD3;