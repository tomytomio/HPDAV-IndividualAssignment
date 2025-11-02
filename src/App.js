import './App.css';
import {useState, useEffect} from 'react'
import {fetchCSV} from "./utils/helper";
import ScatterplotContainer from "./components/scatterplot/ScatterplotContainer";
import ParsetContainer from "./components/parset/ParsetContainer";

function App() {
    console.log("App component function call...")
    const [data,setData] = useState([])
    const [parsetAttrs, setParsetAttrs] = useState([]); // attributes for parset loaded dynamically from CSV
    // every time the component re-render
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
                // Exclude continuous variables and synthetic index
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
        // Handle brush selection - reset parset
        handleBrushSelection: (items) => {
            setSelectedItems(items.map((item) => {return {...item,selected:true}} ));
            setParsetSelection({}); // Clear parset selection
        },
        // Handle click selection - select matching ribbon in parset
        handleClickSelection: (item) => {
            setSelectedItems([{...item, selected:true}]);
            
            // Build parset selection from this single item
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

    // Handle parset selection and convert to items list
    const handleParsetSelection = (selection) => {
        setParsetSelection(selection);
        
        // selection is {attr: Set(values)}
        // filter data to find items matching all selected categories
        if (!selection || Object.keys(selection).length === 0 || 
            Object.values(selection).every(s => !s || s.size === 0)) {
            setSelectedItems([]);
            return;
        }

        const filtered = data.filter(item => {
            for (const [attr, valueSet] of Object.entries(selection)) {
                if (!valueSet || valueSet.size === 0) continue;
                
                // normalize value same way as in parset
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
