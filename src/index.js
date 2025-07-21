// src/index.js - Entry point for BLAPL Loyalty App
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import './index.css';

// Render the root component
ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);

// Service worker registration is handled inside App.js component
