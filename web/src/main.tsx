import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { XProvider } from '@ant-design/x';
import 'antd/dist/reset.css';
import './styles/global.css';
import { theme } from './theme';
import App from './App';

/** Ant Design X 的 locale 需要 antd locale + xLocale 的 `locale` 字段 */
const xLocale = { ...zhCN, locale: 'zh-cn' };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <XProvider theme={theme} locale={xLocale}>
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </XProvider>
  </React.StrictMode>,
);
