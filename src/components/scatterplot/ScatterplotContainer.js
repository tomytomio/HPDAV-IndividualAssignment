import './Scatterplot.css'
import {useEffect, useRef, useState} from 'react';

import ScatterplotD3 from './Scatterplot-d3';

// TODO: import action methods from reducers

function ScatterplotContainer({scatterplotData, xAttribute, yAttribute, selectedItems, scatterplotControllerMethods}){

    const divContainerRef=useRef(null);
    const scatterplotD3Ref = useRef(null);
    const [containerSize, setContainerSize] = useState({width: 800, height: 600});

    // every time the component re-render
    useEffect(()=>{
        // console.log("ScatterplotContainer useEffect (called each time scatterplot re-renders)");
    }); // if no dependencies, useEffect is called at each re-render

    const getChartSize = function(){
        // getting size from parent item
        let width = 800;
        let height = 600;
        if(divContainerRef.current!==undefined && divContainerRef.current !== null){
            width=divContainerRef.current.offsetWidth;
            height=divContainerRef.current.offsetHeight;
        }
        return {width:width,height:height};
    }

    // Track container size changes
    useEffect(() => {
        const updateSize = () => {
            const newSize = getChartSize();
            setContainerSize(newSize);
        };
        
        updateSize();
        window.addEventListener('resize', updateSize);
        
        // Use ResizeObserver if available for more accurate tracking
        let resizeObserver;
        if (divContainerRef.current && window.ResizeObserver) {
            resizeObserver = new ResizeObserver(updateSize);
            resizeObserver.observe(divContainerRef.current);
        }
        
        return () => {
            window.removeEventListener('resize', updateSize);
            if (resizeObserver) resizeObserver.disconnect();
        };
    }, []);

    // did mount called once the component did mount
    useEffect(()=>{
        console.log("ScatterplotContainer useEffect [] called once the component did mount");
        const scatterplotD3 = new ScatterplotD3(divContainerRef.current);
        scatterplotD3.create({size:containerSize});
        scatterplotD3Ref.current = scatterplotD3;
        return ()=>{
            // did unmout, the return function is called once the component did unmount (removed for the screen)
            console.log("ScatterplotContainer useEffect [] return function, called when the component did unmount...");
            const scatterplotD3 = scatterplotD3Ref.current;
            scatterplotD3.clear()
        }
    },[containerSize]);// recreate when size changes


    const scatterplotDataRef = useRef(scatterplotData);
    // did update, called each time dependencies change, dispatch remain stable over component cycles
    useEffect(()=>{
        console.log("ScatterplotContainer useEffect with dependency [scatterplotData, xAttribute, yAttribute, scatterplotControllerMethods], called each time any dependancy changes...");

        const handleOnClick = function(itemData){
            console.log("handleOnClick ...")
            if (scatterplotControllerMethods.handleClickSelection) {
                scatterplotControllerMethods.handleClickSelection(itemData);
            } else {
                scatterplotControllerMethods.updateSelectedItems([itemData]);
            }
        }
        const handleOnMouseEnter = function(itemData){
            // intentionally empty to avoid highlighting on hover
        }
        const handleOnMouseLeave = function(){
            // intentionally empty
        }

        // dedicated handler used for brush selections
        const handleOnSelection = function(items){
            const sel = Array.isArray(items) ? items : [items];
            if (scatterplotControllerMethods.handleBrushSelection) {
                scatterplotControllerMethods.handleBrushSelection(sel);
            } else if (sel.length > 0 ) {
                scatterplotControllerMethods.updateSelectedItems(sel);
            } else if (Array.isArray(items) && items.length === 0) {
                // explicit clear selection
                scatterplotControllerMethods.updateSelectedItems([]);
            }
        }

        const controllerMethods={
            handleOnClick,
            handleOnMouseEnter,
            handleOnMouseLeave,
            handleOnSelection
        }

        if(scatterplotDataRef.current !== scatterplotData) {
            console.log("ScatterplotContainer useEffect with dependency when scatterplotData changes...");
            // get the current instance of scatterplotD3 from the Ref object...
            const scatterplotD3 = scatterplotD3Ref.current
            // call renderScatterplot of ScatterplotD3...;
            scatterplotD3.renderScatterplot(scatterplotData, xAttribute, yAttribute, controllerMethods);
            scatterplotDataRef.current = scatterplotData;
        }
    },[scatterplotData, xAttribute, yAttribute, scatterplotControllerMethods]);// if dependencies, useEffect is called after each data update, in our case only scatterplotData changes.


    useEffect(()=>{
        console.log("ScatterplotContainer useEffect with dependency [selectedItems]," +
            "called each time selectedItems changes...");
        // get the current instance of scatterplotD3 from the Ref object...
        const scatterplotD3 = scatterplotD3Ref.current
        // call renderScatterplot of ScatterplotD3...;
        scatterplotD3.highlightSelectedItems(selectedItems)
    },[selectedItems])
    return(
        <div ref={divContainerRef} className="scatterplotDivContainer col2">
        </div>
    )
}

export default ScatterplotContainer;