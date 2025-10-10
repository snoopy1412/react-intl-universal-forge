import React from 'react'

interface WelcomeCardProps {
  userName: string
  onPrimaryAction: () => void
}

const WelcomeCard: React.FC<WelcomeCardProps> = ({ userName, onPrimaryAction }) => {
  return (
    <section style={{ border: '1px solid #eee', padding: 16, borderRadius: 8, maxWidth: 360 }}>
      <h2>欢迎使用 forge-i18n 示例</h2>
      <p>你好，{userName}！以下内容将展示自动提取的效果：</p>
      <ul>
        <li>点击下方按钮将触发事件</li>
        <li>观察多语言文件的输出变化</li>
        <li>在命令行体验 AI 翻译结果</li>
      </ul>
      <button
        type="button"
        style={{
          padding: '8px 16px',
          border: 'none',
          borderRadius: 4,
          background: '#2f54eb',
          color: '#fff',
          cursor: 'pointer'
        }}
        onClick={onPrimaryAction}
      >
        开始自动化提取
      </button>
    </section>
  )
}

export default WelcomeCard
