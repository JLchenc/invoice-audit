import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import 'antd/dist/reset.css';
import './styles/global.css';
import ThemeModeProvider from '@/components/ThemeModeProvider';
import MessageBinder from '@/components/MessageBinder';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <AntdApp>
        <MessageBinder />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ThemeModeProvider>
  </React.StrictMode>,
);
