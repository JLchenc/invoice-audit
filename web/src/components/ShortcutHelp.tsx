import { Modal, Table } from 'antd';
import { KbdHint } from '@/components/KbdHint';

const SHORTCUTS: { key: string; desc: string }[] = [
  { key: 'J / K', desc: '上一张 / 下一张单据' },
  { key: 'A', desc: '采纳当前单据' },
  { key: 'S', desc: '驳回（打开原因弹窗）' },
  { key: 'E', desc: '编辑当前聚焦字段' },
  { key: '⌘K', desc: '打开命令面板（Ctrl+K 同）' },
  { key: '?', desc: '打开本速查面板' },
  { key: 'Esc', desc: '取消当前操作' },
];

/** `?` 快捷键速查面板（§5.6） */
export default function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} title="快捷键速查" width={420}>
      <Table
        size="small"
        pagination={false}
        showHeader={false}
        rowKey="key"
        dataSource={SHORTCUTS}
        columns={[
          {
            dataIndex: 'key',
            width: 110,
            render: (v: string) => (
              <span style={{ display: 'inline-flex', gap: 3 }}>
                {v.split(' / ').map((k) => (
                  <KbdHint key={k}>{k}</KbdHint>
                ))}
              </span>
            ),
          },
          { dataIndex: 'desc', render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
        ]}
      />
      <div style={{ fontSize: 11, color: 'var(--ia-text-3)', marginTop: 8 }}>
        规则：输入框聚焦时不触发快捷键；所有快捷键在页面右下角有可折叠的常驻提示条。
      </div>
    </Modal>
  );
}
