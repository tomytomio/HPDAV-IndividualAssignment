import React, {useRef, useEffect, useState, useCallback} from 'react';
import ParsetD3 from './Parset-d3';
import './Parset.css';
import {fetchCSV} from '../../utils/helper';

const DEFAULT_AXES = [
    'furnishingstatus', 'prefarea', 'parking', 'airconditioning', 'heating', 'hotwater', 'basement', 'guestroom', 'mainroad', 'stories', 'bathrooms', 'bedrooms'
];

function ParsetContainer(props){
    const elRef = useRef();
    const visRef = useRef();
    const containerRef = useRef();
    const [data, setData] = useState([]);
    const [axes, setAxes] = useState(DEFAULT_AXES);
    const [order, setOrder] = useState({});
    const [size, setSize] = useState({width: 800, height: 600});

    // Use external selection if provided, otherwise manage internally
    const selected = props.selection !== undefined ? props.selection : {};
    const setSelected = props.onSelection || (() => {});

    // Calculate size from container
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const width = containerRef.current.offsetWidth;
                const height = containerRef.current.offsetHeight;
                // Account for control panel height - measure it if it exists
                const controlPanel = containerRef.current.querySelector('.controlPanel');
                const controlHeight = controlPanel ? controlPanel.offsetHeight : 0;
                setSize({width, height: Math.max(300, height - controlHeight - 20)});
            }
        };
        
        updateSize();
        window.addEventListener('resize', updateSize);
        
        // Small delay to ensure control panel is rendered
        const timer = setTimeout(updateSize, 100);
        
        return () => {
            window.removeEventListener('resize', updateSize);
            clearTimeout(timer);
        };
    }, []);

    // load data if not provided
    useEffect(()=>{
        if (props.data && props.data.length>0){ setData(props.data); return; }
        fetchCSV('data/Housing.csv',(res)=>{ setData(res.data); });
    },[props.data]);

    // create vis
    useEffect(()=>{
        if (!elRef.current) return;
        visRef.current = new ParsetD3(elRef.current);
        visRef.current.create({size});
        return ()=>{ visRef.current && visRef.current.clear(); }
    },[elRef, size]);

    // render/update
    const renderVis = useCallback(()=>{
        if (!visRef.current) return;
        const state = {
            selected,
            order,
            onToggle: (attr, key)=>{
                const copy = {...selected};
                const s = new Set(copy[attr] ? Array.from(copy[attr]) : []);
                if (s.has(key)) s.delete(key); else s.add(key);
                copy[attr] = s;
                // notify parent
                setSelected(copy);
            },
            onReorder: (attr,key,newY)=>{
                // compute new order based on current order and newY value
                setOrder(prev=>{
                    const copy = {...prev};
                    const curOrder = copy[attr] ? Array.from(copy[attr]) : null;
                    // if no explicit order, create from current axes categories
                    // simple heuristic: move key to front/back based on sign of newY
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
            }
        };
        visRef.current.render(data, axes, state);
    },[data,axes,selected,order,setSelected]);

    // re-render when data/axes/selection change
    useEffect(()=>{ renderVis(); },[data,axes,selected,order,renderVis]);

    // control UI: toggle axes on/off, reorder axes horizontally
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
                <div style={{marginBottom:6}}>Axes (click to toggle, arrows to reorder):</div>
                <div className="attrList">
                    {DEFAULT_AXES.map(a=> (
                        <div key={a} className="attrItem">
                            <label style={{display:'flex',alignItems:'center',gap:6}}>
                                <input type="checkbox" checked={axes.includes(a)} onChange={()=>toggleAxis(a)}/>
                                <span style={{minWidth:160}}>{a}</span>
                                <button onClick={()=>moveAxis(a,-1)}>&uarr;</button>
                                <button onClick={()=>moveAxis(a,1)}>&darr;</button>
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
