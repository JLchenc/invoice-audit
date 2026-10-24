import { message as staticMessage } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { Key } from 'react';

/**
 * 全站消息提示入口。
 * antd 的 `message.success()` 静态方法挂在 React 树外面，拿不到 ConfigProvider 的 ThemeConfig，
 * 深色模式下会弹出白底黑字的提示条；`App.useApp()` 返回的实例才跟着主题走。
 * 根组件绑定一次，页面和 api 层（非组件位置）都从这里取。
 */
let themed: MessageInstance | null = null;

export function bindMessage(instance: MessageInstance) {
  themed = instance;
}

/** 首屏挂载前（比如子组件 effect 里的请求失败）绑定还没完成，这时退回静态实例，不能把提示丢掉 */
const api = (): MessageInstance => themed ?? (staticMessage as unknown as MessageInstance);

export const message = {
  info: (...args: Parameters<MessageInstance['info']>) => api().info(...args),
  success: (...args: Parameters<MessageInstance['success']>) => api().success(...args),
  error: (...args: Parameters<MessageInstance['error']>) => api().error(...args),
  warning: (...args: Parameters<MessageInstance['warning']>) => api().warning(...args),
  loading: (...args: Parameters<MessageInstance['loading']>) => api().loading(...args),
  open: (args: Parameters<MessageInstance['open']>[0]) => api().open(args),
  destroy: (key?: Key) => api().destroy(key),
};
