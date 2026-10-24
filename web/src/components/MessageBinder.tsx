import { useEffect } from 'react';
import { App } from 'antd';
import { bindMessage } from '@/utils/toast';

/** 把 App.useApp() 拿到的主题化 message 实例交给全站门面，见 utils/toast */
export default function MessageBinder() {
  const { message } = App.useApp();

  useEffect(() => {
    bindMessage(message);
  }, [message]);

  return null;
}
