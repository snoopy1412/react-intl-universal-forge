import React from 'react'

import WelcomeCard from './components/WelcomeCard'

const App: React.FC = () => {
  const userName = 'Alice'

  return (
    <div style={{ fontFamily: 'sans-serif', display: 'grid', gap: 24 }}>
      <h1>示例：自动化提取与翻译</h1>
      <WelcomeCard
        userName={userName}
        onPrimaryAction={() => {
          alert('已触发自动提取流程')
        }}
      />
      <p>
        当前示例包含一个具备中文文案的 React 组件，运行 `pnpm run extract` 后可查看{' '}
        `locales/zh-CN/translation.json` 和 `locales/en-US/translation.json` 的生成效果。
      </p>
    </div>
  )
}

export default App
