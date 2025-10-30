import * as d3 from 'd3'
// import { getDefaultFontSize } from '../../utils/helper';

class ScatterplotD3 {
    margin = {top: 100, right: 10, bottom: 50, left: 100};
    size;
    height;
    width;
    matSvg;
    // add specific class properties used for the vis render/updates
    defaultOpacity=0.3;
    transitionDuration=1000;
    circleRadius = 3;
    xScale;
    yScale;
    pointsG;
    brushG;


    constructor(el){
        this.el=el;
    };

    create = function (config) {
        this.size = {width: config.size.width, height: config.size.height};

        // get the effect size of the view by subtracting the margin
        this.width = this.size.width - this.margin.left - this.margin.right;
        this.height = this.size.height - this.margin.top - this.margin.bottom ;
        console.log("create SVG width=" + (this.width + this.margin.left + this.margin.right ) + " height=" + (this.height+ this.margin.top + this.margin.bottom));
        // initialize the svg and keep it in a class property to reuse it in renderScatterplot()
        this.matSvg=d3.select(this.el).append("svg")
            .attr("width", this.width + this.margin.left + this.margin.right)
            .attr("height", this.height + this.margin.top + this.margin.bottom)
            .append("g")
            .attr("class","matSvgG")
            .attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");
        ;

        this.xScale = d3.scaleLinear().range([0,this.width]);
        this.yScale = d3.scaleLinear().range([this.height,0]);

        // build xAxisG
        this.matSvg.append("g")
            .attr("class","xAxisG")
            .attr("transform","translate(0,"+this.height+")");
        this.matSvg.append("g")
            .attr("class","yAxisG");
        
        // points group (all markers) and brush layer
        this.pointsG = this.matSvg.append("g").attr("class","pointsG");
        this.brushG = this.matSvg.append("g").attr("class","brushG");
    }

    changeBorderAndOpacity(selection, selected){
        selection.style("opacity", selected?1:this.defaultOpacity);

        selection.select(".markerCircle")
            .attr("stroke-width",selected?2:0);
    }

    updateMarkers(selection,xAttribute,yAttribute){
        // transform selection
        selection
            .transition().duration(this.transitionDuration)
            .attr("transform", (item)=>{
                // use scales to return shape position from data values
                const xPos = this.xScale(item[xAttribute]);
                const yPos = this.yScale(item[yAttribute]);
                return "translate("+xPos+","+yPos+")";
            })
        ;
        this.changeBorderAndOpacity(selection,false)
    }

    highlightSelectedItems(selectedItems){
        // use pattern update to change the border and opacity of the markers:
        //      - call this.changeBorderAndOpacity(selection,true) for markers that match selectedItems
        //      - this.changeBorderAndOpacity(selection,false) for markers the do not match selectedItems
        this.matSvg.selectAll(".markerG")
            // all elements with the class .markerG (empty the first time)
            .data(selectedItems,(itemData)=>itemData.index)
            .join(
                enter=>enter,
                update=>{
                    this.changeBorderAndOpacity(update, true);
                },
                exit => {
                    this.changeBorderAndOpacity(exit, false);
                }
            )
        ;
    }

    updateAxis = function(visData,xAttribute,yAttribute){
        // compute min max using d3.min/max(visData.map(item=>item.attribute))
        const minXAxis = d3.min(visData.map((item)=>{return item[xAttribute]}));
        const maxXAxis = d3.max(visData.map((item)=>{return item[xAttribute]}));
        const minYAxis = d3.min(visData.map((item)=>{return item[yAttribute]}));
        const maxYAxis = d3.max(visData.map((item)=>{return item[yAttribute]}));

        this.xScale.domain([minXAxis,maxXAxis]);
        this.yScale.domain([minYAxis,maxYAxis]);

        // create axis with computed scales
        this.matSvg.select(".xAxisG")
            .transition().duration(500)
            .call(d3.axisBottom(this.xScale))
        ;
        this.matSvg.select(".yAxisG")
            .transition().duration(500)
            .call(d3.axisLeft(this.yScale))
    }


    renderScatterplot = function (visData, xAttribute, yAttribute, controllerMethods){
        //force data as an array
        this.data = visData || [];
        console.log("render scatterplot with a new data list ...")
        // build the size scales and x,y axis
        this.updateAxis(visData, xAttribute, yAttribute);

        this.matSvg.selectAll(".markerG")
            // all elements with the class .markerG (empty the first time)
            .data(visData,(itemData)=>itemData.index)
            .join(
                enter=>{
                    // all data items to add:
                    // doesn’exist in the select but exist in the new array
                    const itemG=enter.append("g")
                        .attr("class","markerG")
                        .style("opacity",this.defaultOpacity)
                        .on("click", (event,itemData)=>{
                            controllerMethods.handleOnClick(itemData);
                        })
                        .on("mouseenter", (event, itemData)=>{
                            controllerMethods.handleOnMouseEnter(itemData);
                        })
                        .on("mouseleave", (event, itemData)=>{
                            controllerMethods.handleOnMouseLeave(itemData);
                        });
                    ;
                    // render element as child of each element "g"
                    itemG.append("circle")
                        .attr("class","markerCircle")
                        .attr("r",this.circleRadius)
                        .attr("stroke","red")
                    ;
                    this.updateMarkers(itemG,xAttribute,yAttribute);
                },
                update=>{
                    this.updateMarkers(update,xAttribute,yAttribute)
                },
                exit =>{
                    exit.remove()
                    ;
                }

            )
        // set up brush (2D)
        const brush = d3.brush()
            .extent([[0, 0], [this.width, this.height]])
            .on("end", (event) => {
                if (!event.selection) {
                    // clear selection: prefer a dedicated selection handler if provided
                    if (controllerMethods) {
                        if (typeof controllerMethods.handleOnSelection === 'function') {
                            controllerMethods.handleOnSelection([]);
                        } else if (typeof controllerMethods.updateSelectedItems === 'function') {
                            controllerMethods.updateSelectedItems([]);
                        }
                    }
                    return;
                }
                const [[x0, y0], [x1, y1]] = event.selection;
                // convert pixels to data-space
                const xMin = this.xScale.invert(x0);
                const xMax = this.xScale.invert(x1);
                // note: yScale range is [height,0] so invert accordingly
                const yMax = this.yScale.invert(y0);
                const yMin = this.yScale.invert(y1);

                const selected = this.data.filter(d => {
                    const xv = +d[xAttribute];
                    const yv = +d[yAttribute];
                    return xv >= xMin && xv <= xMax && yv >= yMin && yv <= yMax;
                }).map(d => ({...d, selected:true}));

                // call the dedicated selection handler if present (brush selection)
                if (controllerMethods && typeof controllerMethods.handleOnSelection === 'function') {
                    controllerMethods.handleOnSelection(selected);
                } else if (controllerMethods && typeof controllerMethods.handleOnMouseEnter === 'function') {
                    // fallback to existing mouse enter handler if selection handler not provided
                    controllerMethods.handleOnMouseEnter(selected);
                }
            });

        // ensure only one brush attached
        this.brushG.call(brush);
    }

    clear = function(){
        d3.select(this.el).selectAll("*").remove();
    }
}
export default ScatterplotD3;