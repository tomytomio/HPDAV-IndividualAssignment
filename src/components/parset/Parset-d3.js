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
        this.size = {width: config.size.width || this.width, height: config.size.height || this.height};
        this.width = this.size.width - this.margin.left - this.margin.right;
        this.height = this.size.height - this.margin.top - this.margin.bottom;

        this.svg = d3.select(this.el).append('svg')
            .attr('width', this.width + this.margin.left + this.margin.right)
            .attr('height', this.height + this.margin.top + this.margin.bottom)
            .append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`)
            .attr('class','parset-g');
    }

    computeLayout(data, axes){
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

            let yPos = 0;
            cats.forEach(cat => {
                cat.y = yPos;
                cat.h = (cat.count / total) * this.height;
                yPos += cat.h;
            });
            nodes[attr] = {attr, cats};
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
        const heightFactor = this.height / total;
        paths.forEach(p => { p.h = p.count * heightFactor; p.seg = new Array(axes.length-1).fill(null); });

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
                plist.sort((a,b)=>{
                    const at = a.values[i+1];
                    const bt = b.values[i+1];
                    if (at !== bt) return at.localeCompare(bt);
                    return b.count - a.count; // bigger first
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
                plist.sort((a,b)=>{
                    const as = a.values[i];
                    const bs = b.values[i];
                    if (as !== bs) return as.localeCompare(bs);
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

        return {nodes, paths, total};
    }

    render(data, axes, state){
        // persist inputs for re-render after drag reorder
        this._data = data; this._axes = axes; this._state = state;
    const layout = this.computeLayout(data, axes);

        // Horizontal positions of axes
        const axisCount = axes.length;
    const gap = (axisCount>1) ? ((this.width - 40)/(axisCount-1)) : this.width/2;
    const xPositions = Array.from({length: axisCount}, (_, i)=> i*gap);
    const x = (i) => xPositions[i];

        // Draw axes
        const axisG = this.svg.selectAll('.axisG')
            .data(axes, d=>d)
            .join(enter=>enter.append('g').attr('class','axisG'))
            .attr('transform', (d,i) => `translate(${x(i)},0)`);

        // Draw axis titles
        axisG.selectAll('text.axisTitle')
            .data(d=>[d])
            .join('text')
            .attr('class','axisTitle')
            .attr('x', this.rectW / 2)
            .attr('y',-6)
            .attr('text-anchor', 'middle')
            .text(d=>d);

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

            cats.attr('transform', d=>`translate(0,${d.y})`)
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
            const that = this;
            let dragStartY = 0;
            let hasMoved = false;
            
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

        for (let i=0; i<axes.length-1; i++){
            const group = linksLayer.selectAll(`.linkG-${i}`)
                .data([null])
                .join('g')
                .attr('class', `linkG linkG-${i}`);

            const segs = group.selectAll('path.link')
                .data(layout.paths, d => d.key)
                .join(enter => enter.append('path').attr('class', 'link'));

            segs
                .attr('d', d => {
                    const seg = d.seg[i] || {};
                    const y1 = seg.ySource ?? 0;
                    const y2 = seg.yTarget ?? 0;
                    const h = d.h;
                    const x1 = x(i) + this.rectW;
                    const x2 = x(i+1);

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
        }
    }
}

export default ParsetD3;