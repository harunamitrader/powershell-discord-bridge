import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles/index.css';
import { App } from './app/App';
import { TerminalExportPage } from './app/TerminalExportPage';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
const searchParams = new URLSearchParams(window.location.search);

if (searchParams.get('terminal-export') === '1') {
  root.render(<TerminalExportPage />);
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
