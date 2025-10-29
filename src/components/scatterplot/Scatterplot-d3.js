import * as d3 from "d3";

class ScatterplotD3 {
    margin = {top: 100, right: 10, bottom: 50, left: 100};
    size;
    height;
    width;
    matSvg;
    defaultOpacity = 0.3;
    transitionDuration = 300;
    circleRadius = 3;
    xScale;
    yScale;
    pointsG;
    brushG;
    data = [];

    constructor(el){
        this.el = el;
    };

    create = function (config) {
        this.size = {width: config.size.width, height: config.size.height};

        this.width = this.size.width - this.margin.left - this.margin.right;
        this.height = this.size.height - this.margin.top - this.margin.bottom ;
        // remove previous content
        d3.select(this.el).selectAll("*").remove();

        this.matSvg = d3.select(this.el).append("svg")
            .attr("width", this.width + this.margin.left + this.margin.right)
            .attr("height", this.height + this.margin.top + this.margin.bottom)
            .append("g")
            .attr("class","matSvgG")
            .attr("transform", "translate(" + this.margin.left + "," + this.margin.top + ")");

        this.xScale = d3.scaleLinear().range([0,this.width]);
        this.yScale = d3.scaleLinear().range([this.height,0]);

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
        selection.style("opacity", selected ? 1 : this.defaultOpacity);
        selection.select(".markerCircle")
            .attr("stroke-width", selected ? 2 : 0);
    }

    updateMarkers(selection, xAttribute, yAttribute){
        selection
            .transition().duration(this.transitionDuration)
            .attr("transform", (item)=>{
                const xPos = this.xScale(item[xAttribute]);
                const yPos = this.yScale(item[yAttribute]);
                return "translate("+xPos+","+yPos+")";
            });
        this.changeBorderAndOpacity(selection, false);
    }

    highlightSelectedItems(selectedItems){
        const selectedSet = new Set((selectedItems || []).map(d => d.index));
        this.pointsG.selectAll(".markerG")
            .select(".markerCircle")
            .attr("fill", d => selectedSet.has(d.index) ? "orange" : "steelblue")
            .attr("r", d => selectedSet.has(d.index) ? this.circleRadius + 1.5 : this.circleRadius);

        this.pointsG.selectAll(".markerG")
            .style("opacity", d => selectedSet.size === 0 ? this.defaultOpacity : (selectedSet.has(d.index) ? 1 : this.defaultOpacity))
            .select(".markerCircle")
            .attr("stroke-width", d => selectedSet.has(d.index) ? 2 : 0);
    }

    updateAxis = function(visData,xAttribute,yAttribute){
        const minXAxis = d3.min(visData.map((item)=>{return +item[xAttribute]}));
        const maxXAxis = d3.max(visData.map((item)=>{return +item[xAttribute]}));
        const minYAxis = d3.min(visData.map((item)=>{return +item[yAttribute]}));
        const maxYAxis = d3.max(visData.map((item)=>{return +item[yAttribute]}));

        // fallback if all equal or undefined
        this.xScale.domain([minXAxis === undefined ? 0 : minXAxis, maxXAxis === undefined ? 1 : maxXAxis]);
        this.yScale.domain([minYAxis === undefined ? 0 : minYAxis, maxYAxis === undefined ? 1 : maxYAxis]);

        this.matSvg.select(".xAxisG")
            .transition().duration(200)
            .call(d3.axisBottom(this.xScale));

        this.matSvg.select(".yAxisG")
            .transition().duration(200)
            .call(d3.axisLeft(this.yScale));
    }


    renderScatterplot = function (visData, xAttribute, yAttribute, controllerMethods){
        this.data = visData || [];
        // update scales & axes
        this.updateAxis(this.data, xAttribute, yAttribute);

        // JOIN markers
        const join = this.pointsG.selectAll(".markerG")
            .data(this.data, (itemData)=>itemData.index);

        join.join(
            enter => {
                const g = enter.append("g")
                    .attr("class", "markerG")
                    .attr("transform", (d)=>"translate("+this.xScale(d[xAttribute])+","+this.yScale(d[yAttribute])+")")
                    .style("opacity", this.defaultOpacity);

                g.append("circle")
                    .attr("class","markerCircle")
                    .attr("r", this.circleRadius)
                    .attr("fill","steelblue")
                    .attr("stroke","red")
                    .attr("stroke-width",0)
                    .on("click", (event, d)=>{
                        if(controllerMethods && typeof controllerMethods.handleOnClick === "function"){
                            controllerMethods.handleOnClick(d);
                        }
                    })
                    .on("mouseenter", (event, d)=>{
                        if(controllerMethods && typeof controllerMethods.handleOnMouseEnter === "function"){
                            controllerMethods.handleOnMouseEnter(d);
                        }
                    })
                    .on("mouseleave", (event, d)=>{
                        if(controllerMethods && typeof controllerMethods.handleOnMouseLeave === "function"){
                            controllerMethods.handleOnMouseLeave(d);
                        }
                    });

                return g;
            },
            update => {
                this.updateMarkers(update, xAttribute, yAttribute);
                return update;
            },
            exit => exit.remove()
        );

        // set up brush (2D)
        const that = this;
        const brush = d3.brush()
            .extent([[0, 0], [this.width, this.height]])
            .on("end", (event) => {
                if (!event.selection) {
                    // clear selection
                    if (controllerMethods && typeof controllerMethods.updateSelectedItems === "function") {
                        controllerMethods.updateSelectedItems([]);
                    }
                    return;
                }
                const [[x0, y0], [x1, y1]] = event.selection;
                // convert pixels to data-space
                const xMin = that.xScale.invert(x0);
                const xMax = that.xScale.invert(x1);
                // note: yScale range is [height,0] so invert accordingly
                const yMax = that.yScale.invert(y0);
                const yMin = that.yScale.invert(y1);

                const selected = that.data.filter(d => {
                    const xv = +d[xAttribute];
                    const yv = +d[yAttribute];
                    return xv >= xMin && xv <= xMax && yv >= yMin && yv <= yMax;
                }).map(d => ({...d, selected:true}));

                if (controllerMethods && typeof controllerMethods.updateSelectedItems === "function") {
                    controllerMethods.updateSelectedItems(selected);
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