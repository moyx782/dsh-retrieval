/* Web retrieval — browser half.
 *
 * The only thing the page owns is authorization: which optional credential is
 * stored, and an explicit consent step before one is written. The Host half
 * reads the same references through the credential service, so a token saved
 * here is live for the next tool call without a restart.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-retrieval',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    /** This bundle's package name; also the key the Plugins page dispatches. */
    const PACKAGE = '@local/dsh-retrieval'

    /** The panel id shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'retrieval'

    /** Where a cookie handed over before the panel mounted waits for it. */
    const SITE_AUTH_INBOX_KEY = 'dsh-retrieval.pending-site-auth'

    /** The message type the bundled browser extension posts into this page. */
    const SITE_AUTH_MESSAGE = 'dsh-retrieval-site-auth'

    /** The one live panel that can take a handed-over cookie. */
    const siteAuthInbox = { handler: undefined }

    /** The credential references, in display order. */
    const REFERENCES = [
      {
        ref: 'GITHUB_TOKEN',
        name: { zh: 'GitHub 令牌', en: 'GitHub token' },
        detail: {
          zh: '把 GitHub API 的匿名额度从 60 次/小时提高到 5,000 次/小时，仓库、issue、文件读取都走这条额度。',
          en: 'Raises the GitHub API allowance from 60 to 5,000 requests an hour for repositories, issues and file reads.',
        },
        scope: {
          zh: '只用于 api.github.com 与 raw.githubusercontent.com 的读取请求。',
          en: 'Sent only to api.github.com and raw.githubusercontent.com for reads.',
        },
        optional: true,
        hint: 'ghp_… / github_pat_…',
        obtain: {
          url: 'https://github.com/settings/tokens',
          label: 'github.com/settings/tokens',
          note: {
            zh: '读取公开仓库不需要勾选任何权限。',
            en: 'Reading public repositories needs no scopes.',
          },
        },
      },
      {
        ref: 'JINA_API_KEY',
        name: { zh: 'Jina Reader 令牌', en: 'Jina Reader token' },
        detail: {
          zh: '提高 r.jina.ai 的匿名额度（20 次/分钟）；不填也能用。',
          en: 'Raises the anonymous r.jina.ai allowance (20 requests a minute); the reader tier works without it.',
        },
        scope: {
          zh: '只用于 r.jina.ai 的正文渲染请求，页面 URL 会经过该第三方服务。',
          en: 'Sent only to r.jina.ai when the reader tier runs; the page URL goes through that third party.',
        },
        optional: true,
        hint: 'jina_…',
        obtain: {
          url: 'https://jina.ai/reader/',
          label: 'jina.ai/reader',
          note: {
            zh: '登录后在同一页面的 API Key 面板里创建。',
            en: 'Sign in, then create it in the API Key panel on that page.',
          },
        },
      },
    ]

    const DICT = {
      zh: {
        title: '检索授权',
        lead: '这两项都是可选的：不授权时插件照样工作，只是 GitHub 匿名额度较低、reader 层每分钟可用的次数较少。凭证由 DSH 的凭证服务保存，不写进插件配置。',
        configured: '已授权',
        missing: '未授权',
        source: '来源',
        authorize: '设置…',
        replace: '更换',
        revoke: '撤销',
        consentTitle: '确认授权范围',
        consentLead: '保存前请确认以下范围。任一条件不满足，就点取消。',
        consentCheck: '我已阅读上述范围，允许保存这个令牌。',
        save: '允许并保存',
        cancel: '取消',
        placeholder: '粘贴令牌',
        saving: '保存中…',
        saved: '已保存，下一次工具调用会使用它。',
        revoked: '已撤销。',
        notSet: '未设置',
        notSetOptional: '未设置 · 可选',
        authorizedCount: '{configured}/{total} 已授权 · 均可选',
        collapse: '收起',
        masked: '末尾',
        savedUnverified: '已写入，但读取状态尚未确认；下一次工具调用会验证它。',
        sitesTitle: '需要登录的站点',
        sitesLead: '抓取受登录保护的页面时，工具会把该域名对应的 Cookie 或 Authorization 头一起发过去。凭证只发送给这个域名；除本机回环地址外，只允许 https。装了随附的浏览器插件时，当前页面的 Cookie 可以直接发到这里。',
        sitesEmpty: '还没有为任何域名保存凭证。',
        sitesAdd: '添加站点…',
        sitesCollapse: '收起',
        sitesConfigured: '已保存',
        sitesMissing: '未保存',
        sitesUpdate: '更新',
        sitesDelete: '删除',
        sitesHost: '域名',
        sitesHostHint: 'example.com',
        sitesValueHint: 'Cookie: session=… 或 Authorization: Bearer …',
        sitesConsent: '我确认这是我有权使用的登录凭据，并允许把它保存在本机。',
        sitesFromExtension: '已从浏览器插件填入 Cookie，确认范围后再保存。',
        sitesSaved: '已为该域名保存凭证。',
        sitesRemoved: '已删除该域名的凭证。',
        sitesInvalid: '请填写一个有效的域名，例如 example.com。',
        noRemote: '当前页面没有提供凭证接口，无法在这里保存令牌。可改用环境变量：',
        failed: '保存失败',
        needValue: '先粘贴令牌。',
        needConsent: '请先勾选授权确认。',
      },
      en: {
        title: 'Retrieval credentials',
        lead: 'Both are optional: the bundle works without them, with a lower GitHub allowance and a smaller reader quota. Tokens are stored by the credential service, never in the plugin configuration.',
        configured: 'Authorized',
        missing: 'Not authorized',
        source: 'source',
        authorize: 'Set up…',
        replace: 'Replace',
        revoke: 'Revoke',
        consentTitle: 'Confirm what this grants',
        consentLead: 'Read the scope before saving. Cancel if any part is not what you want.',
        consentCheck: 'I have read this scope and allow this token to be stored.',
        save: 'Allow and save',
        cancel: 'Cancel',
        placeholder: 'Paste the token',
        saving: 'Saving…',
        saved: 'Saved; the next tool call will use it.',
        revoked: 'Revoked.',
        notSet: 'Not set',
        notSetOptional: 'Not set · optional',
        authorizedCount: '{configured}/{total} authorized · both optional',
        collapse: 'Collapse',
        masked: 'ends with',
        savedUnverified: 'Written, but the read-back did not confirm it yet; the next tool call will.',
        sitesTitle: 'Sites that need a sign-in',
        sitesLead: 'When a page sits behind a login, the tool sends this host\'s stored Cookie or Authorization header with the request. The header goes only to that host, and only over https (loopback is exempt). The bundled browser extension can hand the current tab\'s cookies straight to this panel.',
        sitesEmpty: 'No site credential is stored yet.',
        sitesAdd: 'Add a site…',
        sitesCollapse: 'Collapse',
        sitesConfigured: 'Stored',
        sitesMissing: 'Not stored',
        sitesUpdate: 'Replace',
        sitesDelete: 'Delete',
        sitesHost: 'Host',
        sitesHostHint: 'example.com',
        sitesValueHint: 'Cookie: session=… or Authorization: Bearer …',
        sitesConsent: 'I confirm this sign-in is mine to use and allow it to be stored on this machine.',
        sitesFromExtension: 'Filled from the browser extension; confirm the scope before saving.',
        sitesSaved: 'The credential for this host is stored.',
        sitesRemoved: 'The credential for this host is deleted.',
        sitesInvalid: 'Enter a valid host, for example example.com.',
        noRemote: 'This page exposes no credential endpoint, so a token cannot be stored here. Use an environment variable instead:',
        failed: 'Saving failed',
        needValue: 'Paste a token first.',
        needConsent: 'Tick the consent box first.',
      },
    }

    /** @returns the active language, defaulting to Chinese. */
    function languageOf(ctx) {
      const locale = ctx.get('locale')
      const snapshot = locale !== undefined && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined
      const active = snapshot !== undefined && typeof snapshot.active === 'string' ? snapshot.active : undefined
      if (active === undefined) return 'zh'
      return active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    /** Where this panel keeps the list of hosts it has stored a credential for. */
    const SITE_STORE_KEY = 'dsh-retrieval.site-hosts'

    /** @returns the stored host list, ignoring an unreadable value. */
    function loadHosts() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(SITE_STORE_KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter(host => typeof host === 'string' && host !== '') : []
      } catch {
        return []
      }
    }

    /** Persist the host list; a browser that refuses storage still works this session. */
    function storeHosts(hosts) {
      try {
        window.localStorage.setItem(SITE_STORE_KEY, JSON.stringify(hosts))
      } catch {
        // The panel keeps the list in memory for this session.
      }
    }

    /** The Host-side reference name for one host; the two halves must agree. */
    function siteRef(host) {
      return `RETRIEVAL_AUTH_${String(host).toLowerCase().replace(/[^a-z0-9]+/g, '_').toUpperCase()}`
    }

    /** @returns a bare hostname, or '' when the input is not one. */
    function normalizeHost(input) {
      const bare = String(input ?? '').trim().toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/:\d+$/, '')
      return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(bare) ? bare : ''
    }

    /** Pick the string for the active language. */
    function say(language, value) {
      return typeof value === 'string' ? value : (value[language] ?? value.en ?? value.zh ?? '')
    }

    const DICT_TITLE = { zh: '检索授权', en: 'Retrieval credentials' }
    const PANEL_LABEL = { zh: '网页检索', en: 'Web retrieval' }
    const PANEL_LEAD = {
      zh: '在这里授权可选凭证，并查看读取链路的四层顺序。两项凭证都不填也能用。',
      en: 'Authorize the optional credentials here, and review the four-tier read order. Both credentials are optional.',
    }

    /** The sidebar glyph: a page with a lens, matching the bundle icon. */
    function RetrievalIcon({ size }) {
      const edge = typeof size === 'number' ? size : 20
      return h('svg', { width: edge, height: edge, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 2, width: 6.6, height: 9.6, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M4.8 4.9h3M4.8 7.1h3M4.8 9.3h1.8', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('circle', { cx: 10.8, cy: 10.2, r: 2.8, stroke: '#4cc2ff', strokeWidth: 1.4 }),
        h('path', { d: 'M12.8 12.3l1.6 1.6', stroke: '#4cc2ff', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }

    const CSS = `
.wr-page { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-size: 14px; line-height: 1.6; }
.wr-scroll { flex: 1; min-height: 0; overflow: auto; }
.wr-content { max-width: 780px; margin: 0 auto; padding: 28px clamp(24px, 4vw, 48px) 64px; }
.wr-page-title { margin: 0; font-size: 20px; font-weight: 500; }
.wr-page-lead { margin: 6px 0 22px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.wr-summary { margin: 0 0 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.wr-panel { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 8px; color: var(--dsw-alias-label-primary); }
.wr-lead { margin: 0; max-width: 66ch; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.wr-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; }
.wr-row { display: flex; align-items: flex-start; gap: 12px; }
.wr-main { flex: 1; min-width: 0; }
.wr-name { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
.wr-detail { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 19px; }
.wr-meta { margin-top: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.wr-pill { padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 500; line-height: 17px; }
.wr-pill-on { background: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-bg-base); }
.wr-pill-off { border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.wr-pill-opt { border: 1px dashed var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.wr-btn { height: 30px; padding: 0 12px; border: 1px solid transparent; border-radius: 7px; font-size: 12.5px; cursor: pointer; }
.wr-btn:disabled { opacity: .45; cursor: default; }
.wr-btn-outline { border-color: var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); }
.wr-btn-outline:hover:enabled { background: var(--dsw-alias-bg-layer-2); }
.wr-btn-ghost { background: transparent; color: var(--dsw-alias-label-secondary); }
.wr-btn-ghost:hover:enabled { color: var(--dsw-alias-label-primary); }
.wr-btn-primary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.wr-consent { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.wr-consent-title { margin: 0 0 6px; font-size: 12.5px; font-weight: 600; }
.wr-consent p { margin: 0 0 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.wr-scope { margin: 0 0 10px; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 19px; }
.wr-check { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.wr-check input { margin-top: 2px; }
.wr-field { display: flex; gap: 8px; align-items: center; }
.wr-sites { margin-top: 2px; }
.wr-hostlist { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.wr-hostrow { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.wr-host { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.wr-textarea { width: 100%; margin: 8px 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 18px; resize: vertical; }
.wr-textarea:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wr-obtain { margin: 0 0 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.wr-obtain-note { color: var(--dsw-alias-label-secondary); }
.wr-link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.wr-link:hover { text-decoration: underline; }
.wr-input { flex: 1; height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12.5px; }
.wr-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wr-notice { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.wr-error { color: var(--dsw-alias-state-error-primary); }
.wr-tiers { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 19px; }
`

    /**
     * The credentials panel. It renders inside the bundle's own page, so it
     * receives the page's `view` and nothing else.
     */
    function CredentialPanel(props) {
      const ctx = props.ctx
      const language = languageOf(ctx)
      const t = (key, values) => {
        let text = DICT[language][key] ?? DICT.en[key] ?? key
        for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, String(value))
        return text
      }

      const [entries, setEntries] = useState(undefined)
      const [openRef, setOpenRef] = useState('')
      const [draft, setDraft] = useState('')
      const [consent, setConsent] = useState(false)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [failure, setFailure] = useState('')
      const [noRemote, setNoRemote] = useState(false)
      const [hosts, setHosts] = useState(() => loadHosts())
      const [siteForm, setSiteForm] = useState({ open: false, host: '', value: '', consent: false, error: '' })
      const [siteNotice, setSiteNotice] = useState('')

      // A namespace this build does not mount must read as absent, not throw:
      // the Remote service answers unknown namespaces by raising.
      let credentials
      try {
        const remote = ctx.get('remote')
        credentials = remote === undefined || remote === null ? undefined : remote.credentials
      } catch {
        credentials = undefined
      }

      const refresh = useCallback(async () => {
        if (credentials === undefined) {
          setNoRemote(true)
          setEntries({})
          return undefined
        }
        try {
          // Remote calls answer a result envelope: { ok, value } or { ok, error }.
          const refs = [...REFERENCES.map(entry => entry.ref), ...hosts.map(host => siteRef(host))]
          const response = await credentials.describe(refs)
          if (response !== null && typeof response === 'object' && response.ok === false) {
            setFailure(`${t('failed')}: ${response.error?.message ?? 'unknown error'}`)
            setEntries({})
            return undefined
          }
          const value = response !== null && typeof response === 'object' && 'value' in response ? response.value : response
          setEntries(value ?? {})
          setNoRemote(false)
          return value ?? {}
        } catch (error) {
          setFailure(`${t('failed')}: ${error instanceof Error ? error.message : String(error)}`)
          setEntries({})
        }
      }, [credentials, language, hosts])

      useEffect(() => { refresh() }, [refresh])

      // The extension may have posted before this panel mounted, so the value
      // also waits in sessionStorage; either way the form opens with the host
      // and header filled and the consent box still unticked.
      useEffect(() => {
        const fill = (payload) => {
          setSiteForm({ open: true, host: payload.host, value: payload.value, consent: false, error: '' })
          setSiteNotice(t('sitesFromExtension'))
        }
        siteAuthInbox.handler = fill
        try {
          const raw = window.sessionStorage.getItem(SITE_AUTH_INBOX_KEY)
          if (raw !== null) {
            window.sessionStorage.removeItem(SITE_AUTH_INBOX_KEY)
            const payload = JSON.parse(raw)
            const fresh = payload !== null && typeof payload === 'object'
              && typeof payload.host === 'string' && typeof payload.value === 'string'
              && Date.now() - Number(payload.at ?? 0) < 300_000
            if (fresh) fill(payload)
          }
        } catch {
          // Storage disabled: the live message path still works.
        }
        return () => {
          if (siteAuthInbox.handler === fill) siteAuthInbox.handler = undefined
        }
      }, [language])

      /** Write one credential after the consent box has been ticked, then confirm the read-back. */
      const save = async (entry) => {
        if (draft.trim() === '') { setFailure(t('needValue')); return }
        if (!consent) { setFailure(t('needConsent')); return }
        if (credentials === undefined) { setNoRemote(true); return }
        setBusy(true)
        setFailure('')
        setNotice('')
        try {
          const response = await credentials.set(entry.ref, draft.trim())
          if (response !== null && typeof response === 'object' && response.ok === false) {
            setFailure(`${t('failed')}: ${response.error?.message ?? 'unknown error'}`)
            return
          }
          const readBack = await refresh()
          const confirmed = readBack !== undefined && readBack[entry.ref]?.configured === true
          setDraft('')
          setConsent(false)
          setOpenRef('')
          setNotice(confirmed ? t('saved') : t('savedUnverified'))
        } catch (error) {
          setFailure(`${t('failed')}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }

      /** Remove one credential; the environment fallback applies again afterwards. */
      const revoke = async (entry) => {
        if (credentials === undefined) { setNoRemote(true); return }
        setBusy(true)
        setFailure('')
        try {
          const response = await credentials.unset(entry.ref)
          if (response !== null && typeof response === 'object' && response.ok === false) {
            setFailure(`${t('failed')}: ${response.error?.message ?? 'unknown error'}`)
            return
          }
          setNotice(t('revoked'))
          await refresh()
        } catch (error) {
          setFailure(`${t('failed')}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }

      /** Save one host credential after its consent box is ticked. */
      const saveSite = async () => {
        const host = normalizeHost(siteForm.host)
        const fail = message => setSiteForm(previous => ({ ...previous, error: message }))
        if (host === '') { fail(t('sitesInvalid')); return }
        if (siteForm.value.trim() === '') { fail(t('needValue')); return }
        if (!siteForm.consent) { fail(t('needConsent')); return }
        if (credentials === undefined) { setNoRemote(true); return }
        setBusy(true)
        try {
          const response = await credentials.set(siteRef(host), siteForm.value.trim())
          if (response !== null && typeof response === 'object' && response.ok === false) {
            fail(`${t('failed')}: ${response.error?.message ?? 'unknown error'}`)
            return
          }
          const next = hosts.includes(host) ? hosts : [...hosts, host]
          setHosts(next)
          storeHosts(next)
          setSiteForm({ open: false, host: '', value: '', consent: false, error: '' })
          setSiteNotice(t('sitesSaved'))
          setFailure('')
          await refresh()
        } catch (error) {
          fail(`${t('failed')}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }

      /** Forget one host credential and drop it from the panel's index. */
      const removeSite = async (host) => {
        if (credentials === undefined) { setNoRemote(true); return }
        setBusy(true)
        try {
          const response = await credentials.unset(siteRef(host))
          if (response !== null && typeof response === 'object' && response.ok === false) {
            setFailure(`${t('failed')}: ${response.error?.message ?? 'unknown error'}`)
            return
          }
          const next = hosts.filter(entry => entry !== host)
          setHosts(next)
          storeHosts(next)
          setSiteNotice(t('sitesRemoved'))
          await refresh()
        } catch (error) {
          setFailure(`${t('failed')}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }

      const configuredCount = entries === undefined
        ? 0
        : REFERENCES.filter(entry => entries[entry.ref]?.configured === true).length

      const card = (entry) => {
        const info = entries?.[entry.ref]
        const configured = info?.configured === true
        const open = openRef === entry.ref
        const status = configured ? t('configured') : entry.optional ? t('notSetOptional') : t('notSet')
        const meta = []
        if (configured && info?.source !== undefined) meta.push(`${t('source')}: ${info.source}`)
        if (configured && typeof info?.masked === 'string' && info.masked !== '') meta.push(`${t('masked')} ${info.masked}`)
        return h('section', { className: 'wr-card', key: entry.ref },
          h('div', { className: 'wr-row' },
            h('div', { className: 'wr-main' },
              h('div', { className: 'wr-name' },
                say(language, entry.name),
                h('span', { className: `wr-pill ${configured ? 'wr-pill-on' : 'wr-pill-off'}` }, status),
              ),
              h('p', { className: 'wr-detail' }, say(language, entry.detail)),
              meta.length === 0 ? null : h('div', { className: 'wr-meta' }, meta.join(' · ')),
            ),
            h('div', { className: 'wr-field' },
              open
                ? h('button', {
                  type: 'button',
                  className: 'wr-btn wr-btn-ghost',
                  disabled: busy,
                  onClick: () => { setOpenRef(''); setDraft(''); setConsent(false); setFailure('') },
                }, t('collapse'))
                : h('button', {
                  type: 'button',
                  className: 'wr-btn wr-btn-outline',
                  disabled: busy,
                  onClick: () => {
                    setOpenRef(entry.ref)
                    setDraft('')
                    setConsent(false)
                    setFailure('')
                    setNotice('')
                  },
                }, configured ? t('replace') : t('authorize')),
              configured && !open
                ? h('button', {
                  type: 'button',
                  className: 'wr-btn wr-btn-ghost',
                  disabled: busy,
                  onClick: () => revoke(entry),
                }, t('revoke'))
                : null,
            ),
          ),
          open ? h('div', { className: 'wr-consent' },
            h('p', { className: 'wr-consent-title' }, t('consentTitle')),
            h('p', {}, t('consentLead')),
            h('ul', { className: 'wr-scope' },
              h('li', {}, say(language, entry.scope)),
              h('li', {}, language === 'zh'
                ? '令牌保存在 DSH 的凭证服务里，可在本页随时撤销。'
                : 'The token is stored by the DSH credential service and can be revoked on this page.'),
            ),
            h('p', { className: 'wr-obtain' },
              language === 'zh' ? '令牌在这个页面创建：' : 'Create the token here: ',
              h('a', {
                className: 'wr-link',
                href: entry.obtain.url,
                target: '_blank',
                rel: 'noreferrer noopener',
              }, `${say(language, entry.obtain.note) === '' ? entry.obtain.label : entry.obtain.label} ↗`),
              h('span', { className: 'wr-obtain-note' }, ` ${say(language, entry.obtain.note)}`),
            ),
            h('div', { className: 'wr-field' },
              h('input', {
                className: 'wr-input',
                type: 'password',
                autoComplete: 'off',
                spellCheck: false,
                placeholder: `${t('placeholder')} (${entry.hint})`,
                value: draft,
                onChange: event => setDraft(event.target.value),
              }),
            ),
            h('label', { className: 'wr-check' },
              h('input', {
                type: 'checkbox',
                checked: consent,
                onChange: event => setConsent(event.target.checked),
              }),
              h('span', {}, t('consentCheck')),
            ),
            failure !== '' ? h('p', { className: 'wr-notice wr-error' }, failure) : null,
            h('div', { className: 'wr-field' },
              h('button', {
                type: 'button',
                className: 'wr-btn wr-btn-primary',
                disabled: busy || !consent || draft.trim() === '',
                onClick: () => save(entry),
              }, busy ? t('saving') : t('save')),
              h('button', {
                type: 'button',
                className: 'wr-btn wr-btn-ghost',
                disabled: busy,
                onClick: () => { setOpenRef(''); setDraft(''); setConsent(false); setFailure('') },
              }, t('cancel')),
            ),
          ) : null,
        )
      }


      const sitesSection = h('section', { className: 'wr-card wr-sites' },
        h('div', { className: 'wr-row' },
          h('div', { className: 'wr-main' },
            h('div', { className: 'wr-name' },
              t('sitesTitle'),
              h('span', { className: `wr-pill ${hosts.length > 0 ? 'wr-pill-on' : 'wr-pill-off'}` },
                hosts.length === 0 ? t('sitesEmpty') : String(hosts.length)),
            ),
            h('p', { className: 'wr-detail' }, t('sitesLead')),
          ),
          h('button', {
            type: 'button',
            className: 'wr-btn wr-btn-outline',
            disabled: busy,
            onClick: () => setSiteForm(previous => previous.open
              ? { open: false, host: '', value: '', consent: false, error: '' }
              : { open: true, host: '', value: '', consent: false, error: '' }),
          }, siteForm.open ? t('sitesCollapse') : t('sitesAdd')),
        ),
        hosts.length === 0 ? null : h('ul', { className: 'wr-hostlist' },
          hosts.map(host => h('li', { className: 'wr-hostrow', key: host },
            h('code', { className: 'wr-host' }, host),
            h('span', {
              className: `wr-pill ${entries?.[siteRef(host)]?.configured === true ? 'wr-pill-on' : 'wr-pill-off'}`,
            }, entries?.[siteRef(host)]?.configured === true ? t('sitesConfigured') : t('sitesMissing')),
            h('button', {
              type: 'button',
              className: 'wr-btn wr-btn-ghost',
              disabled: busy,
              onClick: () => setSiteForm({ open: true, host, value: '', consent: false, error: '' }),
            }, t('sitesUpdate')),
            h('button', {
              type: 'button',
              className: 'wr-btn wr-btn-ghost',
              disabled: busy,
              onClick: () => removeSite(host),
            }, t('sitesDelete')),
          )),
        ),
        siteForm.open ? h('div', { className: 'wr-consent' },
          h('p', { className: 'wr-consent-title' }, t('consentTitle')),
          h('p', {}, t('consentLead')),
          h('ul', { className: 'wr-scope' },
            h('li', {}, language === 'zh'
              ? '凭证只发给这个域名，不会出现在访问其他站点的请求里。'
              : 'The header goes only to this host, never to another site.'),
            h('li', {}, language === 'zh'
              ? '保存在 DSH 的凭证服务里，可随时在本页删除；除本机回环外只允许 https。'
              : 'Stored by the DSH credential service and deletable here; https only, loopback excepted.'),
          ),
          h('div', { className: 'wr-field' },
            h('input', {
              className: 'wr-input',
              type: 'text',
              autoComplete: 'off',
              spellCheck: false,
              placeholder: `${t('sitesHost')} (${t('sitesHostHint')})`,
              value: siteForm.host,
              onChange: event => setSiteForm(previous => ({ ...previous, host: event.target.value, error: '' })),
            }),
          ),
          h('textarea', {
            className: 'wr-textarea',
            rows: 3,
            spellCheck: false,
            autoComplete: 'off',
            placeholder: t('sitesValueHint'),
            value: siteForm.value,
            onChange: event => setSiteForm(previous => ({ ...previous, value: event.target.value, error: '' })),
          }),
          h('label', { className: 'wr-check' },
            h('input', {
              type: 'checkbox',
              checked: siteForm.consent,
              onChange: event => setSiteForm(previous => ({ ...previous, consent: event.target.checked })),
            }),
            h('span', {}, t('sitesConsent')),
          ),
          siteForm.error === '' ? null : h('p', { className: 'wr-notice wr-error' }, siteForm.error),
          h('div', { className: 'wr-field' },
            h('button', {
              type: 'button',
              className: 'wr-btn wr-btn-primary',
              disabled: busy || !siteForm.consent || siteForm.value.trim() === '' || siteForm.host.trim() === '',
              onClick: saveSite,
            }, busy ? t('saving') : t('save')),
            h('button', {
              type: 'button',
              className: 'wr-btn wr-btn-ghost',
              disabled: busy,
              onClick: () => setSiteForm({ open: false, host: '', value: '', consent: false, error: '' }),
            }, t('cancel')),
          ),
        ) : null,
      )

      return h('div', { className: 'wr-panel' },
        h('style', {}, CSS),
        h('p', { className: 'wr-summary' }, t('authorizedCount', { configured: configuredCount, total: REFERENCES.length })),
        h('p', { className: 'wr-lead' }, t('lead')),
        noRemote
          ? h('p', { className: 'wr-notice wr-error' },
            `${t('noRemote')} ${REFERENCES.map(entry => entry.ref).join(' / ')}`)
          : null,
        failure !== '' && openRef === '' ? h('p', { className: 'wr-notice wr-error' }, failure) : null,
        notice !== '' ? h('p', { className: 'wr-notice' }, notice) : null,
        ...REFERENCES.map(card),
        sitesSection,
        siteNotice === '' ? null : h('p', { className: 'wr-notice' }, siteNotice),
        h('ul', { className: 'wr-tiers' },
          h('li', {}, language === 'zh'
            ? '读取顺序：站点官方 API → 静态抽取 → reader 服务 → 本地浏览器。'
            : 'Read order: the site API, then static extraction, then the reader service, then a local browser.'),
          h('li', {}, language === 'zh'
            ? '静态层遵守 robots.txt；任何一层都不登录、不绕付费墙。'
            : 'The static tier honours robots.txt; no tier signs in or defeats a paywall.'),
        ),
      )
    }

    /**
     * The sidebar page: the same authorization body, framed as a panel with its
     * own title, so the entry in the left column opens something worth opening.
     */
    function RetrievalPage({ ctx }) {
      const language = languageOf(ctx)
      return h('div', { className: 'wr-page' },
        h('style', {}, CSS),
        h('div', { className: 'wr-scroll' },
          h('div', { className: 'wr-content' },
            h('h2', { className: 'wr-page-title' }, say(language, DICT_TITLE)),
            h('p', { className: 'wr-page-lead' }, say(language, PANEL_LEAD)),
            h(CredentialPanel, { ctx }),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.credentials'],
      apply(ctx) {
        const label = () => say(languageOf(ctx), PANEL_LABEL)

        // Only this page's own origin may hand over a cookie, and only a
        // well-formed small payload is accepted. Nothing is stored here: the
        // panel still asks for the explicit confirmation.
        const onMessage = (event) => {
          if (event.origin !== window.location.origin) return
          const data = event.data
          if (data === null || typeof data !== 'object' || data.type !== SITE_AUTH_MESSAGE) return
          if (typeof data.host !== 'string' || typeof data.value !== 'string') return
          if (data.host === '' || data.host.length > 200 || data.value.length > 8000) return
          const payload = { host: data.host, value: data.value, at: Date.now() }
          if (siteAuthInbox.handler !== undefined) {
            siteAuthInbox.handler(payload)
            return
          }
          // No panel mounted yet: leave it for the next mount to pick up.
          try {
            window.sessionStorage.setItem(SITE_AUTH_INBOX_KEY, JSON.stringify(payload))
          } catch {
            // Storage disabled; the person can copy the header instead.
          }
        }
        window.addEventListener('message', onMessage)
        ctx.effect(() => () => window.removeEventListener('message', onMessage), 'retrieval: extension bridge')
        const disposePanel = ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ ctx }),
        }, RetrievalPage))
        ctx.effect(() => () => { if (disposePanel) disposePanel() }, 'retrieval: sidebar panel')

        const disposeEntry = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 35,
          label,
        }, RetrievalIcon))
        ctx.effect(() => () => { if (disposeEntry) disposeEntry() }, 'retrieval: sidebar entry')
      },
    }
  },
})
