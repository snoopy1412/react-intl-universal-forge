import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import { extract } from '../dist/core/extract.js'
import { createConfig } from '../dist/config/index.js'

const SHOULD_CLEAN_FIXTURE = process.env.KEEP_I18N_FIXTURE !== '1'

const TMP_ROOT = (() => {
  if (process.env.I18N_TEST_TMP_DIR) {
    const dir = path.resolve(process.cwd(), process.env.I18N_TEST_TMP_DIR)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }
  return os.tmpdir()
})()

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(TMP_ROOT, prefix))
}

function cleanupTempDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return
  if (SHOULD_CLEAN_FIXTURE) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  } else {
    console.log(`测试保留临时目录: ${dirPath}`)
  }
}

// 静默 logger，避免在 worker 模式下向 stdout 输出干扰 test runner
const silentLogger = {
  log() {},
  warn() {},
  error() {}
}

function createFixtureProject() {
  const root = createTempDir('forge-extract-')
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'Example.tsx'),
    [
      "import React from 'react';",
      '',
      'export function Example() {',
      "  return <button>确认删除吗？</button>",
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

function createComplexFixtureProject() {
  const root = createTempDir('forge-extract-complex-')
  fs.mkdirSync(path.join(root, 'src', 'views'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'views', 'Dashboard.tsx'),
    [
      "import React, { useMemo } from 'react';",
      "import { message } from 'antd';",
      '',
      "const presets = ['很好', '233'];",
      '',
      'export function Dashboard({ status }: { status: boolean }) {',
      "  const options = useMemo(() => ['启用', status ? '禁用' : '未启用'], [status]);",
      '  const columns = useMemo(',
      '    () => [',
      "      { title: '姓名', dataIndex: 'name' },",
      "      { title: `状态：${status ? '已启用' : '未启用'}` }",
      '    ],',
      '    [status]',
      '  );',
      '',
      '  const renderWelcome = () => {',
      "    return `欢迎回来，${status ? '管理员' : '访客'}`;",
      '  };',
      '',
      '  return (',
      '    <>',
      "      <h1>{'欢迎光临'}</h1>",
      "      <p>{renderWelcome()}</p>",
      "      <button onClick={() => message.success('保存成功')}>开始操作</button>",
      '      <ul>',
      '        {options.map((label) => (',
      '          <li key={label}>{label}</li>',
      '        ))}',
      '      </ul>',
      '      <div>',
      '        {columns.map((col) => (',
      "          <span key={col.title}>{`列：${col.title}`}</span>",
      '        ))}',
      '      </div>',
      '      <footer>{presets[0]}</footer>',
      '    </>',
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

function createHookFixtureProject() {
  const root = createTempDir('forge-extract-hooks-')
  fs.mkdirSync(path.join(root, 'src', 'modules'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'modules', 'StatusPanel.tsx'),
    [
      "import React, { useEffect, useMemo } from 'react';",
      "import { Modal, message } from 'antd';",
      '',
      'type PanelProps = { active: boolean }',
      '',
      'export function StatusPanel({ active }: PanelProps) {',
      '  useEffect(() => {',
      "    message.info('加载完成')",
      '  }, [])',
      '',
      '  const menuItems = useMemo(() => {',
      '    return [',
      "      { label: '设置', children: [{ label: '高级' }] },",
      "      { label: active ? '启用中' : '未启用' }",
      '    ]',
      '  }, [active])',
      '',
      '  const handleSave = () => {',
      "    Modal?.confirm({ title: '是否保存修改？' })",
      "    message.warning(`请先确认${active ? '提交' : '激活'}`)",
      '  }',
      '',
      '  return (',
      '    <section>',
      "      <header>{`当前状态：${active ? '开启' : '关闭'}`}</header>",
      '      {active ? <strong>运行中</strong> : <span>已停止</span>}',
      '      <ul>',
      '        {menuItems.map((item) => (',
      '          <li key={item.label}>{item.label}</li>',
      '        ))}',
      '      </ul>',
      '      <button onClick={handleSave}>保存</button>',
      '    </section>',
      '  )',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

function createReuseTranslationFixtureProject() {
  const root = createTempDir('forge-extract-reuse-')
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'Reuse.tsx'),
    [
      "import React from 'react';",
      '',
      'export function Reuse() {',
      '  return (',
      '    <div>',
      "      <button>确认删除吗？</button>",
      "      <span>处理中</span>",
      '    </div>',
      '  )',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

function createTopLevelIntlFixtureProject() {
  const root = createTempDir('forge-extract-top-level-')
  fs.mkdirSync(path.join(root, 'src', 'layout'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'layout', 'Header.tsx'),
    [
      "import React from 'react';",
      '',
      "const TITLE = '欢迎使用控制台';",
      '',
      'const MESSAGES = {',
      "  title: '控制台标题',",
      "  description: '请及时查看任务状态'",
      '};',
      '',
      'export function DashboardHeader() {',
      '  return (',
      '    <section>',
      '      <h1>{TITLE}</h1>',
      '      <h2>{MESSAGES.title}</h2>',
      '      <p>{MESSAGES.description}</p>',
      '    </section>',
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

function createNotificationFixtureProject() {
  const root = createTempDir('forge-extract-notify-')
  fs.mkdirSync(path.join(root, 'src', 'services'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'services', 'notifier.ts'),
    [
      "import { notification } from 'antd';",
      '',
      'export function notifySuccess(status: boolean) {',
      '  notification.show({',
      "    title: '操作成功',",
      "    body: status ? '数据保存成功' : '数据已同步'",
      '  })',
      "  throw new Error('发生未知错误')",
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

function createDiagnosticsFixtureProject() {
  const root = createTempDir('forge-extract-diagnostic-')
  fs.mkdirSync(path.join(root, 'src', 'utils'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'utils', 'logger.ts'),
    [
      'export function report(status?: { warn?: (...args: any[]) => void }) {',
      "  console.log('调试信息');",
      "  const upper = '多语言'.toUpperCase();",
      "  status?.warn?.('系统错误', { message: '请稍后再试' });",
      '  return upper;',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

function createDataColumnsFixtureProject() {
  const root = createTempDir('forge-extract-data-columns-')
  fs.mkdirSync(path.join(root, 'src', 'pages', 'material'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'material', 'data.tsx'),
    [
      "import React from 'react';",
      '',
      'export const materialColumns = () => [',
      '  {',
      '    title: () => (',
      '      <span>',
      "        <span style={{ color: 'red', marginRight: '4px' }}>*</span>",
      '        重量(g)',
      '      </span>',
      '    )',
      '  },',
      '  {',
      '    render() {',
      "      return <span>NoContent</span>",
      '    }',
      '  }',
      ']',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 将中文提取为翻译文件', async () => {
  const projectRoot = createFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.tsx'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const zhPath = config.getOutputPath('zh_CN')
    const enPath = config.getOutputPath('en_US')

    assert.ok(fs.existsSync(zhPath), '中文翻译文件应存在')
    assert.ok(fs.existsSync(enPath), '英文翻译文件应存在')

    const zhData = JSON.parse(fs.readFileSync(zhPath, 'utf-8'))
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'))

    const key = Object.keys(zhData).find((k) => zhData[k] === '确认删除吗？')
    assert.ok(key, '应生成包含中文文本的 key')
    assert.equal(enData[key], '', '新增语言应填充为空字符串等待翻译')
  } finally {
    cleanupTempDir(projectRoot)
  }
})

test('extract 处理含 JSX 的数据配置文件中文', async () => {
  const projectRoot = createDataColumnsFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.{ts,tsx}'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))
    const key = Object.keys(detailData).find((k) => detailData[k].text === '重量(g)')
    assert.ok(key, '含 JSX 的数据文件应被提取重量(g) 文案')
  } finally {
    cleanupTempDir(projectRoot)
  }
})

test('extract 处理复杂 React 场景与数组常量', async () => {
  const projectRoot = createComplexFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.{ts,tsx}'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const zhPath = config.getOutputPath('zh_CN')
    const detailPath = config.getOutputDetailPath('zh_CN')

    const zhData = JSON.parse(fs.readFileSync(zhPath, 'utf-8'))
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = [
      '欢迎光临',
      '欢迎回来，{value0}',
      '管理员',
      '访客',
      '启用',
      '禁用',
      '未启用',
      '保存成功',
      '开始操作',
      '很好',
      '姓名',
      '状态：{value0}',
      '已启用',
      '列：{col_title}'
    ]
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `应提取文本: ${text}`)
      assert.equal(zhData[key], text, `源语言应保留原文: ${text}`)
    })

    const unexpected = Object.keys(detailData).find((k) => detailData[k].text === '233')
    assert.equal(unexpected, undefined, '非中文的字符串不应提取')
  } finally {
    cleanupTempDir(projectRoot)
  }
})

test('extract 处理 hooks、可选调用与动态模板', async () => {
  const projectRoot = createHookFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.{ts,tsx}'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = [
      '加载完成',
      '设置',
      '高级',
      '启用中',
      '未启用',
      '是否保存修改？',
      '请先确认{value0}',
      '提交',
      '激活',
      '当前状态：{value0}',
      '开启',
      '关闭',
      '运行中',
      '已停止',
      '保存'
    ]

    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `应提取文本: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

test('extract 再次执行时保留已有翻译并合并新增文案', async () => {
  const projectRoot = createReuseTranslationFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.{ts,tsx}'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))
    const existingKey = Object.keys(detailData)[0]
    assert.ok(existingKey, '第一次提取后应存在至少一个 key')

    const enPath = config.getOutputPath('en_US')
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'))
    enData[existingKey] = '已存在翻译'
    fs.writeFileSync(enPath, JSON.stringify(enData, null, 2), 'utf-8')

    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'Extra.tsx'),
      [
        "import React from 'react';",
        '',
        'export function Extra() {',
        "  return <div>请稍后再试</div>",
        '}',
        ''
      ].join('\n'),
      'utf-8'
    )

    await extract({ config, logger: silentLogger })

    const updatedEn = JSON.parse(fs.readFileSync(enPath, 'utf-8'))
    assert.equal(
      updatedEn[existingKey],
      '已存在翻译',
      '再次提取时应保留已有的非空翻译'
    )

    const newDetailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))
    const newKey = Object.keys(newDetailData).find(
      (k) => newDetailData[k].text === '请稍后再试'
    )
    assert.ok(newKey, '新增中文文案应被提取')
    assert.equal(
      updatedEn[newKey],
      '',
      '新增 key 在目标语言文件中应初始化为空字符串'
    )
  } finally {
    cleanupTempDir(projectRoot)
  }
})

test('extract 将顶层常量转换为 intl.get 并生成告警', async () => {
  const projectRoot = createTopLevelIntlFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.{ts,tsx}'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const headerPath = path.join(projectRoot, 'src', 'layout', 'Header.tsx')
    const transformed = fs.readFileSync(headerPath, 'utf-8')

    assert.match(
      transformed,
      /const TITLE = intl\.get\(/,
      '顶层常量应替换为 intl.get 调用'
    )
    assert.match(
      transformed,
      /get\s+title\(\)\s*{\s*return intl\.get\(/,
      '对象属性应转化为 getter 并调用 intl.get'
    )
    assert.match(
      transformed,
      /get\s+description\(\)\s*{\s*return intl\.get\(/,
      '同一对象的其他属性也应转换为 getter'
    )

    const warningPath = path.join(projectRoot, 'docs', 'i18n-top-level-warnings.md')
    const warningContent = fs.readFileSync(warningPath, 'utf-8')
    assert.ok(
      warningContent.includes('Header.tsx'),
      '顶层 intl.get 使用应写入告警文档'
    )
    assert.ok(
      warningContent.includes('TITLE'),
      '告警文档应包含常量名称'
    )

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))
    ;['欢迎使用控制台', '控制台标题', '请及时查看任务状态'].forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `顶层常量相关文案应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

test('extract 解析 notification.show 与 Error 场景中的中文', async () => {
  const projectRoot = createNotificationFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.{ts,tsx}'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))
    ;['操作成功', '数据保存成功', '数据已同步', '发生未知错误'].forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `notification 与 Error 中的文案应被提取: ${text}`)
    })

    const notifierPath = path.join(projectRoot, 'src', 'services', 'notifier.ts')
    const transformed = fs.readFileSync(notifierPath, 'utf-8')

    assert.match(
      transformed,
      /notification\.show\(\{\s*title:\s*intl\.get\(/s,
      'notification.show 标题应替换为 intl.get'
    )
    assert.match(
      transformed,
      /body:\s*status\s*\?\s*intl\.get\(/s,
      'notification.show 中的 body 分支应均替换为 intl.get'
    )
    assert.match(
      transformed,
      /throw new Error\(intl\.get\(/,
      'Error 构造器中的中文应替换为 intl.get'
    )
  } finally {
    cleanupTempDir(projectRoot)
  }
})

test('extract 报告未识别与遗漏的中文样本', async () => {
  const projectRoot = createDiagnosticsFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.ts'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))
    const detailTexts = Object.values(detailData).map((item) =>
      typeof item === 'string' ? item : item.text
    )
    assert.ok(detailTexts.includes('请稍后再试'), '应正常提取非跳过的中文内容')
    assert.ok(!detailTexts.includes('调试信息'), '被跳过的控制台输出不应写入详情')

    const reportPath = config.getOutputReportPath('zh_CN')
    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
    const loggerPath = path.join(projectRoot, 'src', 'utils', 'logger.ts')
    const stat = reportData.fileStats[loggerPath]

    assert.ok(stat, '报告中应包含 logger.ts 的统计信息')
    assert.equal(stat.unrecognizedSamples.length, 1, '应记录 1 条未识别样本')
    assert.equal(stat.unrecognizedSamples[0].text, '调试信息')
    assert.match(
      stat.unrecognizedSamples[0].reason,
      /skipFunctionCall:console\.log/,
      '未识别样本需要标注跳过原因'
    )

    assert.equal(stat.missingSamples.length, 1, '应记录 1 条遗漏样本')
    assert.equal(stat.missingSamples[0].text, '多语言')

    assert.equal(
      reportData.summary.totalUnrecognizedSamples,
      1,
      '汇总统计应包含未识别样本数量'
    )
    assert.equal(
      reportData.summary.totalMissingSamples,
      1,
      '汇总统计应包含遗漏样本数量'
    )
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createNestedComponentFixtureProject() {
  const root = createTempDir('forge-extract-nested-')
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'Nested.tsx'),
    [
      "import React from 'react';",
      '',
      'export function Nested() {',
      '  const items = [',
      "    { id: 1, label: '首页', children: [{ id: 11, label: '概览' }] },",
      "    { id: 2, label: '设置', children: [{ id: 21, label: '账户' }, { id: 22, label: '安全' }] }",
      '  ];',
      '',
      '  return (',
      '    <nav>',
      '      {items.map(item => (',
      '        <div key={item.id}>',
      '          <span>{item.label}</span>',
      '          <ul>',
      '            {item.children.map(child => (',
      '              <li key={child.id}>{child.label}</li>',
      '            ))}',
      '          </ul>',
      '        </div>',
      '      ))}',
      '    </nav>',
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理嵌套数组与对象中的中文', async () => {
  const projectRoot = createNestedComponentFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.tsx'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = ['首页', '概览', '设置', '账户', '安全']
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `嵌套对象中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createConditionalRenderFixtureProject() {
  const root = createTempDir('forge-extract-cond-')
  fs.mkdirSync(path.join(root, 'src', 'views'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'views', 'Conditional.tsx'),
    [
      "import React from 'react';",
      '',
      'export function Conditional({ mode }: { mode: string }) {',
      '  return (',
      '    <div>',
      "      {mode === 'edit' ? <button>保存修改</button> : <button>查看详情</button>}",
      "      {mode === 'admin' && <span>管理员模式</span>}",
      "      {mode !== 'guest' || <p>游客访问</p>}",
      '    </div>',
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理条件渲染中的中文文案', async () => {
  const projectRoot = createConditionalRenderFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.tsx'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = ['保存修改', '查看详情', '管理员模式', '游客访问']
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `条件渲染中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createEventHandlerFixtureProject() {
  const root = createTempDir('forge-extract-event-')
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'Events.tsx'),
    [
      "import React from 'react';",
      "import { message, Modal } from 'antd';",
      '',
      'export function Events() {',
      '  const handleDelete = () => {',
      '    Modal.confirm({',
      "      title: '确认删除',",
      "      content: '此操作不可撤销，确定要删除吗？',",
      '      onOk: () => {',
      "        message.success('删除成功');",
      '      },',
      '      onCancel: () => {',
      "        message.info('已取消');",
      '      }',
      '    });',
      '  };',
      '',
      '  return <button onClick={handleDelete}>删除</button>;',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理事件处理器中的中文', async () => {
  const projectRoot = createEventHandlerFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.tsx'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = [
      '确认删除',
      '此操作不可撤销，确定要删除吗？',
      '删除成功',
      '已取消',
      '删除'
    ]
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `事件处理器中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createSpreadOperatorFixtureProject() {
  const root = createTempDir('forge-extract-spread-')
  fs.mkdirSync(path.join(root, 'src', 'utils'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'utils', 'messages.ts'),
    [
      'export const commonMessages = {',
      "  confirm: '确认',",
      "  cancel: '取消',",
      "  save: '保存'",
      '};',
      '',
      'export const formMessages = {',
      '  ...commonMessages,',
      "  submit: '提交',",
      "  reset: '重置'",
      '};',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理展开运算符的对象合并', async () => {
  const projectRoot = createSpreadOperatorFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.ts'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = ['确认', '取消', '保存', '提交', '重置']
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `展开运算符对象中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createArrowFunctionFixtureProject() {
  const root = createTempDir('forge-extract-arrow-')
  fs.mkdirSync(path.join(root, 'src', 'helpers'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'helpers', 'formatters.ts'),
    [
      'export const formatStatus = (status: boolean) => status ? "已激活" : "未激活";',
      '',
      'export const getErrorMessage = (code: number) => {',
      '  const messages = {',
      "    404: '页面不存在',",
      "    500: '服务器错误',",
      "    403: '无权访问'",
      '  };',
      '  return messages[code] || "未知错误";',
      '};',
      '',
      'export const validators = [',
      "  (v: string) => v.length > 0 || '不能为空',",
      "  (v: string) => v.length < 20 || '长度超限'",
      '];',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理箭头函数中的中文', async () => {
  const projectRoot = createArrowFunctionFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.ts'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = [
      '已激活',
      '未激活',
      '页面不存在',
      '服务器错误',
      '无权访问',
      '未知错误',
      '不能为空',
      '长度超限'
    ]
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `箭头函数中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createJSXAttributeFixtureProject() {
  const root = createTempDir('forge-extract-jsx-attr-')
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'Form.tsx'),
    [
      "import React from 'react';",
      '',
      'export function Form() {',
      '  return (',
      '    <form>',
      '      <input',
      '        type="text"',
      '        placeholder="请输入用户名"',
      '        aria-label="用户名输入框"',
      '        title="必填项"',
      '      />',
      '      <button type="submit" aria-label="提交表单">',
      '        提交',
      '      </button>',
      '    </form>',
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理 JSX 属性中的中文', async () => {
  const projectRoot = createJSXAttributeFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.tsx'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = ['请输入用户名', '用户名输入框', '必填项', '提交表单', '提交']
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `JSX 属性中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createSwitchCaseFixtureProject() {
  const root = createTempDir('forge-extract-switch-')
  fs.mkdirSync(path.join(root, 'src', 'utils'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'utils', 'status.ts'),
    [
      'export function getStatusText(status: string): string {',
      '  switch (status) {',
      "    case 'pending':",
      "      return '待处理';",
      "    case 'processing':",
      "      return '处理中';",
      "    case 'completed':",
      "      return '已完成';",
      "    case 'failed':",
      "      return '失败';",
      '    default:',
      "      return '未知状态';",
      '  }',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理 switch-case 语句中的中文', async () => {
  const projectRoot = createSwitchCaseFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.ts'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = ['待处理', '处理中', '已完成', '失败', '未知状态']
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `switch-case 中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})

function createDefaultPropsFixtureProject() {
  const root = createTempDir('forge-extract-props-')
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'Button.tsx'),
    [
      "import React from 'react';",
      '',
      'interface ButtonProps {',
      '  text?: string;',
      '  confirmText?: string;',
      '}',
      '',
      'export function Button({ text = "点击按钮", confirmText = "确认操作" }: ButtonProps) {',
      '  return (',
      '    <div>',
      '      <button>{text}</button>',
      '      <span>{confirmText}</span>',
      '    </div>',
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf-8'
  )
  return root
}

test('extract 处理函数参数默认值中的中文', async () => {
  const projectRoot = createDefaultPropsFixtureProject()
  try {
    const config = createConfig(
      {
        input: ['src/**/*.tsx'],
        localesDir: 'locales',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN']
        },
        keyGeneration: {
          strategy: 'semantic',
          ai: {
            enabled: false
          }
        }
      },
      { cwd: projectRoot }
    )

    await extract({ config, logger: silentLogger })

    const detailPath = config.getOutputDetailPath('zh_CN')
    const detailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'))

    const expectTexts = ['点击按钮', '确认操作']
    expectTexts.forEach((text) => {
      const key = Object.keys(detailData).find((k) => detailData[k].text === text)
      assert.ok(key, `函数参数默认值中的文本应被提取: ${text}`)
    })
  } finally {
    cleanupTempDir(projectRoot)
  }
})
