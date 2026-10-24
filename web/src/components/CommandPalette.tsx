import { useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Input, Modal, Typography } from 'antd';
import type { InputRef } from 'antd/es/input';
import { SearchOutlined } from '@ant-design/icons';
import { KbdHint } from '@/components/KbdHint';

export interface CommandItem {
  key: string;
  group: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

/** ⌘K / Ctrl+K 命令面板（§5.6）：跳单据 / 切页面 / 切主题 */
export default function CommandPalette({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (open) {
      setKeyword('');
      setActive(0);
      // Modal 打开后再聚焦，否则拿不到实例
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return items;
    return items.filter((i) => `${i.label} ${i.hint ?? ''} ${i.group}`.toLowerCase().includes(k));
  }, [items, keyword]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((i) => {
      const list = map.get(i.group) ?? [];
      list.push(i);
      map.set(i.group, list);
    });
    return [...map.entries()];
  }, [filtered]);

  const commit = (item?: CommandItem) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ia-text-3)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <KbdHint>↑</KbdHint>
            <KbdHint>↓</KbdHint> 选择 <KbdHint>Enter</KbdHint> 执行 <KbdHint>Esc</KbdHint> 关闭
          </span>
          <span>共 {filtered.length} 项</span>
        </div>
      }
      width={520}
      title={null}
      closable={false}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--ia-split)' }}>
        <Input
          ref={inputRef}
          size="large"
          variant="borderless"
          prefix={<SearchOutlined style={{ color: 'var(--ia-text-3)' }} />}
          placeholder="搜索页面、单据号或执行操作…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % Math.max(1, filtered.length));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              commit(filtered[active]);
            }
          }}
        />
      </div>

      <div className="ia-scroll" style={{ maxHeight: 380, overflow: 'auto', padding: '6px 6px 10px' }}>
        {filtered.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配命令" style={{ margin: '24px 0' }} />
        ) : (
          groups.map(([group, list]) => (
            <div key={group} style={{ marginBottom: 4 }}>
              <div style={{ padding: '6px 10px', fontSize: 11, letterSpacing: 0.5, color: 'var(--ia-text-3)' }}>
                {group}
              </div>
              {list.map((item) => {
                const idx = filtered.indexOf(item);
                const on = idx === active;
                return (
                  <div
                    key={item.key}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => commit(item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: on ? 'var(--ia-primary-soft)' : 'transparent',
                    }}
                  >
                    <span style={{ color: on ? 'var(--ia-primary)' : 'var(--ia-text-2)', display: 'flex' }}>
                      {item.icon}
                    </span>
                    <span style={{ fontSize: 13 }}>{item.label}</span>
                    {item.hint && (
                      <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                        {item.hint}
                      </Typography.Text>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
