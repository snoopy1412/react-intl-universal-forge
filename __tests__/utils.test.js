import test from 'node:test'
import assert from 'node:assert/strict'

import { deepMerge } from '../dist/utils/deep-merge.js'
import {
  identifyTextType,
  extractSemantic,
  generateSemanticKey,
  extractContextInfo
} from '../dist/core/common-utils.js'

test('deepMerge 深度合并对象并维持输入不可变', () => {
  const target = {
    nested: { a: 1, keep: true },
    arr: ['legacy'],
    optional: 'stay'
  }

  const source = {
    nested: { b: 2 },
    arr: ['override'],
    extra: { flag: true },
    optional: undefined
  }

  const result = deepMerge(target, source)

  assert.deepEqual(result, {
    nested: { a: 1, keep: true, b: 2 },
    arr: ['override'],
    extra: { flag: true },
    optional: 'stay'
  })

  assert.notStrictEqual(
    result.nested,
    target.nested,
    '嵌套对象需要深拷贝避免造成引用共享'
  )
  assert.notStrictEqual(
    result.arr,
    source.arr,
    '数组应复制而非直接引用源对象'
  )

  result.nested.a = 42
  result.arr.push('new')

  assert.equal(target.nested.a, 1, '修改结果不应影响原始 target')
  assert.equal(source.arr.length, 1, '修改结果不应影响原始 source')
})

test('common-utils 能准确识别文案类型并生成语义化 key', () => {
  assert.equal(identifyTextType('确认删除吗？'), 'confirm')
  assert.equal(identifyTextType('提交成功'), 'success')
  assert.equal(identifyTextType('保存'), 'action')
  assert.equal(identifyTextType('请输入用户名'), 'input')
  assert.equal(identifyTextType('系统设置'), 'label')
  assert.equal(identifyTextType('发生未知错误，请稍后重试'), 'error')

  assert.equal(extractSemantic('请输入用户名', 4), '请输入用')

  const semantic = extractSemantic('请输入用户名', 6)
  const key = generateSemanticKey('请输入用户名', 4, 6, true)
  const [semanticPart, hashPart] = key.split('_')

  assert.equal(
    semanticPart,
    `input.${semantic}`,
    '语义部分应包含识别到的类型前缀'
  )
  assert.match(hashPart, /^[0-9a-f]{4}$/)

  const context = extractContextInfo(
    'src/pages/orders/components/SummaryPanel.tsx'
  )
  assert.deepEqual(context, { area: 'orders', componentName: 'SummaryPanel' })

  const keyWithoutPrefix = generateSemanticKey('欢迎光临', 6, 4, false)
  const [pureSemantic] = keyWithoutPrefix.split('_')
  assert.equal(pureSemantic, '欢迎光临', '关闭类型前缀时语义部分应为原始截断值')

  const contextFromPascal = extractContextInfo('src/components/Header/index.tsx')
  assert.deepEqual(contextFromPascal, { componentName: 'Header' })
})
