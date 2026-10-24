/** 键帽（§7.2）：快捷键提示统一走这里，避免手写 <kbd> 样式漂移 */
export function KbdHint({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}

export default KbdHint;

/** 快捷键 + 说明的组合提示 */
export function KbdRow({ keys, text }: { keys: string[]; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {keys.map((k) => (
          <KbdHint key={k}>{k}</KbdHint>
        ))}
      </span>
      <span style={{ fontSize: 12, color: 'var(--ia-text-2)' }}>{text}</span>
    </span>
  );
}
