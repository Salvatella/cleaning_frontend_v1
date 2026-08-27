import React from 'react';
import { createRoot } from 'react-dom/client';
// HashRouter y no BrowserRouter: así funciona igual en localhost, en
// GitHub Pages bajo /usuario/repo/, o abriendo el index.html a pelo. Sin
// configuración de servidor ni el truco del 404.html.
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
