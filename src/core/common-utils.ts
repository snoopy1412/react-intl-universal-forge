import crypto from 'node:crypto'

import type { ExtractedContextInfo, TextType } from '../types.js'

export function identifyTextType(text: string): TextType {
  if (/[吗？?]$/.test(text) || /^(确认|是否)/.test(text)) return 'confirm'
  if (/(不能|禁止|错误|失败|异常)/.test(text)) return 'error'
  if (/(成功|完成|已)/.test(text)) return 'success'
  if (/^(删除|取消|确定|提交|保存|编辑|新增|修改|查看|下载|上传|导入|导出)/.test(text)) return 'action'
  if (/^(请输入|请选择|请填写)/.test(text)) return 'input'
  if (/^(用户|系统|管理|设置|配置)/.test(text) && text.length <= 10) return 'label'
  return 'text'
}

export function extractSemantic(text: string, maxLength: number): string {
  const cleaned = text.replace(/[，。！？；：、""''（）【】《》\s\n\r]/g, '')
  return cleaned.substring(0, maxLength)
}

export function generateSemanticKey(
  text: string,
  hashLength = 4,
  maxSemanticLength = 20,
  useTypePrefix = true
): string {
  const hash = crypto.createHash('md5').update(text).digest('hex').substring(0, hashLength)

  let semantic = extractSemantic(text, maxSemanticLength)

  if (useTypePrefix) {
    const typePrefix = identifyTextType(text)
    semantic = `${typePrefix}.${semantic}`
  }

  return `${semantic}_${hash}`
}

export function extractContextInfo(filePath: string): ExtractedContextInfo {
  const context: ExtractedContextInfo = {}

  const pageMatch = filePath.match(/pages\/([^/]+)/)
  if (pageMatch) {
    context.area = pageMatch[1]
  }

  const componentMatch = filePath.match(/components\/([^/]+)/)
  if (componentMatch) {
    context.componentName = componentMatch[1]
  }

  const fileName = filePath
    .split('/')
    .pop()
    ?.replace(/\.(tsx?|jsx?)$/, '')
  if (fileName && /^[A-Z]/.test(fileName)) {
    context.componentName = fileName
  }

  return context
}
