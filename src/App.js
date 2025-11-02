import './App.css';
import {useState, useEffect} from 'react'
import {fetchCSV} from "./utils/helper";
import ScatterplotContainer from "./components/scatterplot/ScatterplotContainer";
import ParsetContainer from "./components/parset/ParsetContainer";

function App() {
    console.log("App component function call...")
    const [data,setData] = useState([])
    const [parsetAttrs, setParsetAttrs] = useState([]); // parset attributes from CSV
    // runs on every render (debug)
    useEffect(()=>{
        console.log("App useEffect (called each time App re-renders)");
    }); // if no dependencies, useEffect is called at each re-render

    useEffect(()=>{
        console.log("App did mount");
        fetchCSV("data/Housing.csv",(response)=>{
            console.log("initial setData() ...")
            const rows = response.data || [];
            setData(rows);
            if (rows.length > 0) {
                const keys = Object.keys(rows[0] || {});
                // skip continuous vars and the synthetic index
                const attrs = keys.filter(k => k !== 'price' && k !== 'area' && k !== 'index');
                setParsetAttrs(attrs);
            }
        })
        return ()=>{
            console.log("App did unmount");
        }
    },[])

    const [selectedItems, setSelectedItems] = useState([])
    const [parsetSelection, setParsetSelection] = useState({});

    const scatterplotControllerMethods= {
        updateSelectedItems: (items) =>{
            setSelectedItems(items.map((item) => {return {...item,selected:true}} ));
        },
    // brush: multi-select in scatterplot -> clear parset selection
        handleBrushSelection: (items) => {
            setSelectedItems(items.map((item) => {return {...item,selected:true}} ));
            setParsetSelection({}); // Clear parset selection
        },
    // click: single point -> build a parset selection for it
        handleClickSelection: (item) => {
            setSelectedItems([{...item, selected:true}]);
            
            // build per-attribute selection from this one item
            const newSelection = {};
            const attrs = (parsetAttrs && parsetAttrs.length>0)
                ? parsetAttrs
                : Object.keys(item).filter(k => k !== 'price' && k !== 'area' && k !== 'index');
            attrs.forEach(attr => {
                let v = item[attr];
                if (v === true || v === false) v = String(v);
                else if (v === null || v === undefined || v === '') v = 'NA';
                else v = String(v);
                newSelection[attr] = new Set([v]);
            });
            setParsetSelection(newSelection);
        }
    };

    // parset -> scatterplot: convert selection to item list
    const handleParsetSelection = (selection) => {
        setParsetSelection(selection);
        
    // selection looks like {attr: Set(values)}; keep items matching all chosen categories
        if (!selection || Object.keys(selection).length === 0 || 
            Object.values(selection).every(s => !s || s.size === 0)) {
            setSelectedItems([]);
            return;
        }

        const filtered = data.filter(item => {
            for (const [attr, valueSet] of Object.entries(selection)) {
                if (!valueSet || valueSet.size === 0) continue;
                
                // normalize same way as parset
                let v = item[attr];
                if (v === true || v === false) v = String(v);
                else if (v === null || v === undefined || v === '') v = 'NA';
                else v = String(v);
                
                if (!valueSet.has(v)) return false;
            }
            return true;
        });

        setSelectedItems(filtered.map(item => ({...item, selected: true})));
    };

    return (
        <div className="App">
            <div id={"MultiviewContainer"} className={"row"}>
                <div style={{flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column'}}>
                    <ScatterplotContainer 
                        scatterplotData={data} 
                        xAttribute={"area"} 
                        yAttribute={"price"} 
                        selectedItems={selectedItems} 
                        scatterplotControllerMethods={scatterplotControllerMethods}
                    />
                </div>
                <div style={{flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column'}}>
                    <ParsetContainer 
                        data={data}
                        selection={parsetSelection}
                        onSelection={handleParsetSelection}
                    />
                </div>
                
            </div>
        </div>
    );
}

export default App;
