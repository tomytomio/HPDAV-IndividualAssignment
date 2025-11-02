## 1. Overview

This project implements an interactive visualization system combining a Parallel Sets with a scatterplot for exploring multidimensional housing data. The visualization enables users to explore relationships between categorical attributes and identify patterns through coordinated selection and filtering.

### Key Features
- Interactive parallel sets visualization
- Interactive scatterplot showing price vs. area relationships


## 2 Architecture

The application follows a modular React + D3 architecture.
we put the logic of the 2 plots inside folders located inside of the components folder. `scatterplot` for the scatterplot logic and `parset` for the parallel sets logic. 

### 2.1 Parallel Sets (Parset)
The parset visualization displays relationship across multiple dimensions:

**Key Components:**
- **Layers:** Vertical dimension representing categories (bedrooms, bathrooms, stories, etc.)
- **Ribbons:** Flow paths connecting categories across Layers with width proportional to data frequency/amount. Each ribbon have all the categories (bedrooms, parking, ...)
- **Interactive Layer Controls:** Checkboxes to toggle layers, arrow buttons to reorder them.
- **Selection:** When clicking on a value inside a layer, this value is added/remove from the selection set. All ribbons within this caracteristic set is highlighted.

**Technical Features:**
- **Category aggregation:** Small values (< 1% of data) grouped as 'Others' to reduce clutter
- **Drag-to-reorder:** Values can be manually reordered within each layers
- **Ribbon grouping:** Ribbon inside the selection groups themselfs for better readability 
- **Ribbon Organizer:** Clicking the `Organize Ribbon` button optimize the ribbon ordering, limiting overlaps.  

### 2.2 Scatterplot
The scatterplot displays quantitative relationships:

**Axes:**
- X-axis: Living area (square feet)
- Y-axis: Price (USD)

**Interactions:**
- **Brush selection:** Click and drag to select data points in a rectangular region
- **Brush maneuver:** the brush region can be resized and moved. (also reset itself when clicking outside the region)
- **Point highlighting:** Selected points are emphasized

### 2.2 Interaction 

1. **Scatterplot → Parset:**
   - User select an individual element on the scatterplot 
   - Values of cathegorie is selected (allows to see characteristics)
   - Corresponding ribbon in parset is highlighted

2. **Parset → Scatterplot:**
   - User clicks a category in the parset
   - All data points matching that exact combination across all displayed axes are selected



## 3. Advanced Features

### 3.1 Manual Reorganization
**"Organize ribbons" button** applies a multi-pass barycentric heuristic:
- Iteratively reorders categories to minimize ribbon crossings
- Considers both left and right neighbor positions
- Preserves user's manual adjustments as tie-breakers
- Typically runs 3 iterations for balanced optimization

### 3.2 Dynamic Layer Management
- Add/remove axes using checkboxes
- Reorder axes using ← → arrow buttons



## 4. Known Limitations & Future Work

### Current Limitations
1. **No animated transitions** - Layout changes are instant rather than smoothly animated

### Potential Enhancements

1. **Visual Improvements:**
   - Add smooth D3 transitions for category reordering
   - Add legend explaining color mapping

2. **Analysis Features:**
   - Statistical summary panel showing counts, percentages
