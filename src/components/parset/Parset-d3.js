import * as d3 from 'd3';

class ParsetD3 {
    margin = {top: 20, right: 20, bottom: 20, left: 20};
    
    constructor(el){
        this.el = el;
        this.svg = null;
        this.width = 800;
        this.height = 400;
        this.rectW = 6; // slim vertical line width
        this.categoryGap = 2; // gap between categories in pixels
        this.order = {}; // per-attribute custom order for categories
        this.minCategoryRatio = 0.01; // categories below this ratio are grouped as 'Others'
        this._lastSelectionHash = null; // track selection changes to avoid infinite reorganize loops
    }

    // ---------- Utility helpers ----------
    normalize(v){
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

    computeLayout(data, axes){
        // Guard: if no axes selected yet, return empty layout
        if (!axes || axes.length === 0) {
            return {nodes: {}, paths: [], total: data ? data.length : 0};
        }
        const nodes = {};
        const total = data.length;

        // local alias to avoid repeated this access in hot loops
        const normalize = this.normalize;

        // 1) Compute categories and counts for each axis; determine small categories
        const categoryMaps = {}; // raw counts per axis
        const catMapping = {};   // per-axis mapping: original value -> (value or 'Others')
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

            // Build mapping to aggregate small categories into 'Others'
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
            // If only one category or no small ones, keep as-is
            if (othersCount === 0) {
                // keep mapping as identity
            }
            catMapping[attr] = mapping;
        });

    // Build nodes (categories after mapping)
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

            // Sort categories by persisted order (from drag), else by count desc; keep 'Others' last
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

            let yPos = 35; // Start below the axis titles (highest title at 10, need space)
            cats.forEach(cat => {
                cat.y = yPos;
                cat.h = (cat.count / total) * (this.height - 35); // Adjust height to account for top offset
                yPos += cat.h;
            });
            nodes[attr] = {attr, cats};
        });

        // Quick index lookup for category order per axis
        const indexOrder = {};
        axes.forEach(attr => {
            const m = new Map();
            nodes[attr].cats.forEach((c, j)=> m.set(c.key, j));
            indexOrder[attr] = m;
        });

        // 2) Compute full-path tuples across all axes (apply category aggregation mapping)
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

        // Sort paths lexicographically for stable stacking
        const paths = Array.from(pathMap.values()).sort((p1, p2) => {
            for (let i=0; i<axes.length; i++){
                const c = p1.values[i].localeCompare(p2.values[i]);
                if (c !== 0) return c;
            }
            return p2.count - p1.count; // tie-breaker by count desc
        });

        // 3) Assign per-pair segment positions so ribbons are grouped on both sides
    const heightFactor = (this.height - 35) / (total || 1); // Adjust for top offset
    const segLen = Math.max(0, axes.length - 1);
    paths.forEach(p => { p.h = p.count * heightFactor; p.seg = new Array(segLen).fill(null); });

        // maps for quick category base y lookup
        const baseY = {};
        axes.forEach(attr => {
            const m = new Map();
            nodes[attr].cats.forEach(c => m.set(c.key, c.y));
            baseY[attr] = m;
        });

        for (let i=0; i<axes.length-1; i++){
            const aSrc = axes[i];
            const aTgt = axes[i+1];

            // Group by source category then sort by target to group adjacent ribbons on left side
            const bySource = new Map();
            paths.forEach(p => {
                const s = p.values[i];
                if (!bySource.has(s)) bySource.set(s, []);
                bySource.get(s).push(p);
            });
            const srcOffsets = new Map();
            nodes[aSrc].cats.forEach(c => srcOffsets.set(c.key, baseY[aSrc].get(c.key)));
            bySource.forEach((plist, sKey) => {
                // Sort by target category visual order to align stacks towards next axis
                plist.sort((a,b)=>{
                    const at = a.values[i+1];
                    const bt = b.values[i+1];
                    const ia = indexOrder[aTgt].get(at) ?? 0;
                    const ib = indexOrder[aTgt].get(bt) ?? 0;
                    if (ia !== ib) return ia - ib;
                    return b.count - a.count; // tie-breaker: bigger first
                });
                let cur = srcOffsets.get(sKey) ?? baseY[aSrc].get(sKey) ?? 0;
                plist.forEach(p => {
                    if (!p.seg[i]) p.seg[i] = {};
                    p.seg[i].ySource = cur;
                    cur += p.h;
                });
                srcOffsets.set(sKey, cur);
            });

            // Group by target category then sort by source to group adjacent ribbons on right side
            const byTarget = new Map();
            paths.forEach(p => {
                const t = p.values[i+1];
                if (!byTarget.has(t)) byTarget.set(t, []);
                byTarget.get(t).push(p);
            });
            const tgtOffsets = new Map();
            nodes[aTgt].cats.forEach(c => tgtOffsets.set(c.key, baseY[aTgt].get(c.key)));
            byTarget.forEach((plist, tKey) => {
                // Sort by source category visual order to align stacks from previous axis
                plist.sort((a,b)=>{
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
        // Guard on input readiness
        if (!data || data.length === 0 || !axes || axes.length === 0 || !this.svg) return;
        // persist inputs for re-render after drag reorder
        this._data = data; this._axes = axes; this._state = state;
        // If a React-managed order is provided, prefer it to keep deterministic across external updates
        if (state && state.order && Object.keys(state.order).length > 0) {
            this.order = {...this.order, ...state.order};
        }

        // Auto-reorganize on selection change to group selected ribbons (only if selection actually changed)
        const selectionHash = JSON.stringify(state.selected || {});
        const hasSelection = state.selected && Object.keys(state.selected).some(k => state.selected[k] && state.selected[k].size > 0);
        if (hasSelection && selectionHash !== this._lastSelectionHash) {
            this._lastSelectionHash = selectionHash;
            this.reorganizeForSelection(data, axes, state);
            // Don't return - continue to render with the new order
        } else if (!hasSelection && this._lastSelectionHash !== null) {
            this._lastSelectionHash = null; // reset when selection is cleared
        }

        const layout = this.computeLayout(data, axes);

        // Horizontal positions of axes
        const axisCount = axes.length;
        const width = Number.isFinite(this.width) ? this.width : 0;
        const gap = (axisCount>1) ? ((width - 40)/(axisCount-1)) : width/2;
        const xPositions = Array.from({length: axisCount}, (_, i)=> i*gap);
        const x = (i) => {
            const v = xPositions[i];
            return Number.isFinite(v) ? v : 0;
        };

        // Draw axes
        const axisG = this.svg.selectAll('.axisG')
            .data(axes, d=>d)
            .join(enter=>enter.append('g').attr('class','axisG'))
            .attr('transform', (d,i) => `translate(${x(i)},0)`);

        // Draw axis titles - alternate height to avoid overlap (odd layers higher, even layers lower)
        // Position at top of plot, inside the visible space
        const rectW = this.rectW; // capture for closure
        axisG.each(function(attr, axisIndex) {
            d3.select(this).selectAll('text.axisTitle')
                .data([attr])
                .join('text')
                .attr('class','axisTitle')
                .attr('x', rectW / 2)
                .attr('y', (axisIndex % 2 === 0) ? 25 : 10) // even: 25, odd: 10 (higher)
                .attr('text-anchor', 'middle')
                .text(d=>d);
        });

        // Draw categories for each axis
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

            // Category label: vertically centered; for the first axis use left-aligned text so it stays visible
            cats.select('text.catLabel')
                .attr('x', d => (i === 0 ? this.rectW + 6 : this.rectW / 2))
                .attr('y', d=> Math.max(10, d.h/2))
                .attr('dy', '0.35em')
                .attr('text-anchor', i === 0 ? 'start' : 'middle')
                .text(d=>`${d.key} (${d.count})`)
                .style('font-size','12px')
                .style('pointer-events', 'none');

            // Enable drag to reorder categories within this axis
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
                        .raise(); // bring to front while dragging
                })
                .on('drag', function(event, d){
                    if (Math.abs(event.y - dragStartY) > 3) {
                        hasMoved = true;
                    }
                    // Calculate new position
                    const ny = Math.max(0, Math.min(that.height - d.h, d._originalY + (event.y - dragStartY)));
                    d._ny = ny;
                    d3.select(this).attr('transform', `translate(0,${ny})`);
                })
                .on('end', function(event, d){
                    d3.select(this).classed('dragging', false);
                    
                    if (hasMoved && d._ny != null) {
                        // Calculate which position this category should be in based on _ny
                        const temp = node.cats.map(c => ({
                            key: c.key,
                            originalY: c.y,
                            newY: (c === d) ? d._ny : c.y,
                            centerY: (c === d) ? (d._ny + d.h/2) : (c.y + c.h/2)
                        }));
                        
                        // Sort by the center position to determine new order
                        temp.sort((a,b)=> a.centerY - b.centerY);
                        
                        // Save the new order
                        that.order = that.order || {};
                        that.order[attr] = temp.map(c => c.key);
                        // notify host
                        if (that._state && typeof that._state.onOrderChanged === 'function') {
                            that._state.onOrderChanged({[attr]: that.order[attr]});
                        }
                        // Re-render with joins only (avoid clearing/recreating svg)
                        that.render(that._data, that._axes, that._state);
                    } else {
                        // Reset position if not dragged enough
                        d3.select(this).attr('transform', `translate(0,${d.y})`);
                    }
                    
                    // Clean up temp properties
                    delete d._ny;
                    delete d._originalY;
                    hasMoved = false;
                })
            );

            // Add click handler on rect only
            cats.select('rect.catRect')
                .style('cursor', 'move')
                .on('click', function(event, d){
                    event.stopPropagation();
                    // Only trigger selection if we didn't just finish dragging
                    setTimeout(() => {
                        if (!hasMoved && state.onToggle) {
                            state.onToggle(attr, d.key);
                        }
                    }, 10);
                });
        });

        // Draw ribbons (path segments) between each adjacent pair of axes using full-path tuples
        const linksLayer = this.svg.selectAll('.linksLayer')
            .data([null])
            .join('g')
            .attr('class', 'linksLayer');

        // Precompute effective selection sets for displayed axes
        const effSelectedEntries = state.selected ? Object.entries(state.selected).filter(([a,s])=> axes.includes(a) && s && s.size>0) : [];
        const hasActiveSelection = effSelectedEntries.length>0;
        const matchesSelection = (path) => {
            if (!hasActiveSelection) return false;
            for (const [a, s] of effSelectedEntries){
                if (!s.has(path.byAttr[a])) return false;
            }
            return true;
        };

        // Build link groups using data join keyed by segment index, so extra groups are removed when axes change
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

            // Reorder DOM so near-straight flows (source index close to target index) are drawn last (on top)
            const idxSrc = layout.indexOrder[axes[segIndex]];
            const idxTgt = layout.indexOrder[axes[segIndex+1]];
            segs.sort((a,b)=>{
                const as = idxSrc.get(a.values[segIndex]) ?? 0;
                const at = idxTgt.get(a.values[segIndex+1]) ?? 0;
                const bs = idxSrc.get(b.values[segIndex]) ?? 0;
                const bt = idxTgt.get(b.values[segIndex+1]) ?? 0;
                const da = Math.abs(as - at);
                const db = Math.abs(bs - bt);
                // larger misalignment first, smaller last (on top)
                return db - da;
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

    // Compute an automatic ordering of categories per axis using multi-pass barycentric sweeps
    // Takes current axis order and category orders into account, and the current axes (layers) positions.
    autoArrange(options={}){
        if (!this._data || !this._axes || this._axes.length < 2) return;
        const axes = this._axes.slice();
        const layout = this.computeLayout(this._data, axes);
        if (!layout) return;

        // Start from current orders (including any manual drags) as tie-breakers
        const orderMap = {...(this.order || {})};

        // Helper to build index maps for quick lookups
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

        // Barycenter ordering towards neighbor axis
        const reorderToward = (axisIndex, towardRight, idxMap) => {
            const a = axes[axisIndex];
            const neighborIndex = towardRight ? axisIndex+1 : axisIndex-1;
            if (neighborIndex < 0 || neighborIndex >= axes.length) return;
            const b = axes[neighborIndex];
            const idxB = idxMap[b];

            // Current order of categories on axis a to use as tie-breaker
            const currentOrderA = (orderMap[a] && orderMap[a].length)
                ? orderMap[a]
                : layout.nodes[a].cats.map(c => c.key);
            const curIdxA = new Map(currentOrderA.map((k,j)=>[k,j]));

            const avgIndex = new Map();
            const weightSum = new Map();

            // Use existing paths; weights are counts
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

        // Perform alternating sweeps to consider both left and right neighbors
        const iters = Math.max(1, Math.min(6, options.iterations || 3));
        for (let iter=0; iter<iters; iter++){
            let idxMap = buildIdxMap(orderMap);
            // Left-to-right pass: align each axis to its left neighbor
            for (let i=1; i<axes.length; i++){
                reorderToward(i, /*towardRight=*/false, idxMap);
                idxMap = buildIdxMap(orderMap);
            }
            // Right-to-left pass: align each axis to its right neighbor
            for (let i=axes.length-2; i>=0; i--){
                reorderToward(i, /*towardRight=*/true, idxMap);
                idxMap = buildIdxMap(orderMap);
            }
        }

        this.order = orderMap;
        // notify host to persist order
        if (this._state && typeof this._state.onOrderChanged === 'function') {
            this._state.onOrderChanged(orderMap);
        }
        this.render(this._data, this._axes, this._state);
    }

    // Reorganize categories to group selected ribbons together when selection is active
    reorganizeForSelection(data, axes, state){
        if (!state || !state.selected || axes.length < 2) return;
        const layout = this.computeLayout(data, axes);
        if (!layout) return;

        // Determine which paths match the selection
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

        // Build index maps for current order
        const buildIdxMap = () => {
            const idx = {};
            axes.forEach(a => {
                const baseOrder = (orderMap[a] && orderMap[a].length)
                    ? orderMap[a]
                    : layout.nodes[a].cats.map(c => c.key);
                idx[a] = new Map(baseOrder.map((k, j)=>[k, j]));
            });
            return idx;
        };

        // For each axis, compute a score per category: categories with selected flows get avg neighbor position
        axes.forEach((attr, axisIndex) => {
            const cats = layout.nodes[attr].cats.map(c => c.key);
            const scored = cats.map(catKey => {
                // Filter paths touching this category on this axis
                const touching = layout.paths.filter(p => p.values[axisIndex] === catKey);
                const selectedTouching = touching.filter(matchesSelection);

                if (selectedTouching.length === 0) {
                    // No selected flows: push to bottom, sort by count desc
                    return {key: catKey, isSelected: false, avg: Number.MAX_SAFE_INTEGER, count: touching.reduce((s,p)=>s+p.count,0)};
                }

                // Compute weighted average neighbor position from both left and right
                let sumWeightedPos = 0;
                let sumWeight = 0;
                const idxMap = buildIdxMap();

                // Left neighbor contribution
                if (axisIndex > 0) {
                    const leftAttr = axes[axisIndex - 1];
                    const leftIdx = idxMap[leftAttr];
                    selectedTouching.forEach(p => {
                        const neighborCat = p.values[axisIndex - 1];
                        const pos = leftIdx.get(neighborCat) ?? 0;
                        sumWeightedPos += pos * p.count;
                        sumWeight += p.count;
                    });
                }

                // Right neighbor contribution
                if (axisIndex < axes.length - 1) {
                    const rightAttr = axes[axisIndex + 1];
                    const rightIdx = idxMap[rightAttr];
                    selectedTouching.forEach(p => {
                        const neighborCat = p.values[axisIndex + 1];
                        const pos = rightIdx.get(neighborCat) ?? 0;
                        sumWeightedPos += pos * p.count;
                        sumWeight += p.count;
                    });
                }

                const avg = sumWeight > 0 ? (sumWeightedPos / sumWeight) : 0;
                return {key: catKey, isSelected: true, avg, count: selectedTouching.reduce((s,p)=>s+p.count,0)};
            });

            // Sort: selected categories by avg neighbor position, then unselected by count desc
            scored.sort((a, b) => {
                if (a.isSelected && !b.isSelected) return -1;
                if (!a.isSelected && b.isSelected) return 1;
                if (a.isSelected && b.isSelected) return a.avg - b.avg;
                return b.count - a.count;
            });

            orderMap[attr] = scored.map(d => d.key);
        });

        this.order = orderMap;
        // Don't notify host here - let the reorganization happen silently without triggering React state update
        // The order will be used in the immediate re-render below
    }
}

export default ParsetD3;