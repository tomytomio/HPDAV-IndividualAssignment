import React, {useRef, useEffect, useState, useCallback} from 'react';
import ParsetD3 from './Parset-d3';
import './Parset.css';
import {fetchCSV} from '../../utils/helper';

// figure out which columns we can use here (skip continuous scatterplot vars + synthetic fields)
const deriveAllAttributes = (rows) => {
    if (!rows || rows.length === 0) return [];
    // Collect keys from the first non-empty row
    const first = rows.find(r => r && Object.keys(r).length > 0) || rows[0];
    const keys = Object.keys(first);
    // Exclude known continuous variables used by scatterplot and the synthetic 'index'
    const exclude = new Set(['price','area','index']);
    return keys.filter(k => !exclude.has(k));
}

function ParsetContainer(props){
    const elRef = useRef();
    const visRef = useRef();
    const containerRef = useRef();
    const [data, setData] = useState([]);
    const [allAttrs, setAllAttrs] = useState([]);
    const [axes, setAxes] = useState([]);
    const [order, setOrder] = useState({});
    const [size, setSize] = useState({width: 800, height: 600});

    // use selection passed from parent if any, otherwise noop setter
    const selected = props.selection !== undefined ? props.selection : {};
    const setSelected = props.onSelection || (() => {});

    // measure available size from the container
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const width = containerRef.current.offsetWidth;
                const height = containerRef.current.offsetHeight;
                // subtract control panel height if present
                const controlPanel = containerRef.current.querySelector('.controlPanel');
                const controlHeight = controlPanel ? controlPanel.offsetHeight : 0;
                setSize({width, height: Math.max(300, height - controlHeight - 20)});
            }
        };
        
        updateSize();
        window.addEventListener('resize', updateSize);
        
    // tiny delay to catch late layout
        const timer = setTimeout(updateSize, 100);
        
        return () => {
            window.removeEventListener('resize', updateSize);
            clearTimeout(timer);
        };
    }, []);

    // load CSV if data wasn't provided as prop
    useEffect(()=>{
        if (props.data && props.data.length>0){ setData(props.data); return; }
        fetchCSV('data/Housing.csv',(res)=>{ setData(res.data); });
    },[props.data]);

    // derive attributes from data and initialize axes once
    useEffect(()=>{
        if (!data || data.length === 0) return;
        const attrs = deriveAllAttributes(data);
        setAllAttrs(attrs);
        // Initialize axes only if not set yet
        setAxes(prev => (prev && prev.length>0) ? prev : attrs);
    },[data]);

    

    // draw/update the viz
    const renderVis = useCallback(()=>{
        if (!visRef.current) return;
        if (!axes || axes.length === 0 || !data || data.length === 0) {
            // nothing ready yet
            return;
        }
        const state = {
            selected,
            order,
            onToggle: (attr, key)=>{
                const copy = {...selected};
                const s = new Set(copy[attr] ? Array.from(copy[attr]) : []);
                if (s.has(key)) s.delete(key); else s.add(key);
                copy[attr] = s;
                // bubble up selection change
                setSelected(copy);
            },
            onReorder: (attr,key,newY)=>{
                // quick heuristic to build a new order based on drop position
                setOrder(prev=>{
                    const copy = {...prev};
                    const curOrder = copy[attr] ? Array.from(copy[attr]) : null;
                    // if no explicit order yet, start with just the dragged key
                    // move to front/back depending on how far it was dragged
                    if (!curOrder){ copy[attr] = [key]; }
                    else {
                        const idx = curOrder.indexOf(key);
                        if (idx>-1) curOrder.splice(idx,1);
                        // if dragged downward beyond half height -> push to end
                        if (newY>100) curOrder.push(key); else curOrder.unshift(key);
                        copy[attr] = curOrder;
                    }
                    return copy;
                });
            },
            onOrderChanged: (newOrder)=>{
                // sync order coming from D3 (autoArrange, etc.)
                setOrder(prev => ({...prev, ...newOrder}));
            }
        };
        visRef.current.render(data, axes, state);
    },[data,axes,selected,order,setSelected]);

    // create the D3 vis and re-render when size changes
    useEffect(()=>{
        if (!elRef.current) return;
    // clear any previous svg
        if (visRef.current) { visRef.current.clear(); }
        visRef.current = new ParsetD3(elRef.current);
        visRef.current.create({size});
    // try to render immediately if data/axes are ready
        renderVis();
        return ()=>{ visRef.current && visRef.current.clear(); }
    },[elRef, size, renderVis]);

    // re-render when data/axes/selection/order change
    useEffect(()=>{ renderVis(); },[data,axes,selected,order,renderVis]);

    // control bar: toggle axes and reorder them horizontally
    const toggleAxis = (attr)=>{
        setAxes(prev=> prev.includes(attr) ? prev.filter(a=>a!==attr) : [...prev,attr]);
    }

    const moveAxis = (attr, dir)=>{
        setAxes(prev=>{
            const idx = prev.indexOf(attr); if (idx<0) return prev;
            const n = prev.slice();
            const ni = Math.max(0, Math.min(n.length-1, idx+dir));
            n.splice(idx,1);
            n.splice(ni,0,attr);
            return n;
        })
    }

    return (
        <div ref={containerRef} className="parset-root" style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column'}}>
            <div className="controlPanel">
                <div style={{marginBottom:6, display:'flex', alignItems:'center', gap:8}}>
                    <span>Axes (click to toggle, use left/right arrows to reorder)</span>
                    <button type="button" title="Organize ribbons to reduce overlap" onClick={()=>{ visRef.current && visRef.current.autoArrange && visRef.current.autoArrange(); }}>Organize ribbons</button>
                </div>
                <div className="attrList">
                    {allAttrs.map(a=> (
                        <div key={a} className="attrItem">
                            <label style={{display:'flex',alignItems:'center',gap:6}}>
                                <input type="checkbox" checked={axes.includes(a)} onChange={()=>toggleAxis(a)}/>
                                <span style={{minWidth:160}}>{a}</span>
                                <button aria-label="Move left" title="Move left" onClick={()=>moveAxis(a,-1)}>&larr;</button>
                                <button aria-label="Move right" title="Move right" onClick={()=>moveAxis(a,1)}>&rarr;</button>
                            </label>
                        </div>
                    ))}
                </div>
            </div>

            <div ref={elRef} style={{width: '100%', flex: 1, minHeight: 0}} />
        </div>
    )
}

export default ParsetContainer;
