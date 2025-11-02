import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    // I usually comment StrictMode while debugging (avoids the double-render in dev)
    // <React.StrictMode>
        <App />
    // </React.StrictMode>
);

