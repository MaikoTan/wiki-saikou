/**
 * MediaWiki Api for Axios
 * Provides the API call methods similar to `mw.Api` at non-mw environments
 *
 * @author Dragon-Fish <dragon-fish@qq.com>
 * @license MIT
 */

import { Ref, ref, computed, ComputedRef } from '@vue/reactivity'
import {
  Fexios,
  FexiosConfigs,
  FexiosRequestOptions,
  FexiosFinalContext,
} from 'fexios'

export class MediaWikiApi {
  baseURL: Ref<string>
  private requestHandlerRef: ComputedRef<Fexios>
  private defaultOptionsRef: Ref<Partial<FexiosConfigs>>
  private defaultParamsRef: Ref<MwApiParams>
  private tokens: Record<string, string>
  cookies: Record<string, string> = {}

  constructor(baseURL?: string, options?: Partial<FexiosConfigs>) {
    // For MediaWiki browser environment
    if (!baseURL && typeof window === 'object' && (window as any).mediaWiki) {
      const { wgServer, wgScriptPath } =
        (window as any).mediaWiki?.config?.get(['wgServer', 'wgScriptPath']) ||
        {}
      if (typeof wgServer === 'string' && typeof wgScriptPath === 'string') {
        baseURL = `${wgServer}${wgScriptPath}/api.php`
      }
    }
    if (typeof baseURL !== 'string') {
      throw new Error('baseURL is undefined')
    }
    // Init
    this.baseURL = ref(baseURL)
    this.tokens = {}
    this.defaultParamsRef = ref({})
    this.defaultOptionsRef = ref({} as any)

    // Set default values
    this.defaultParams = {
      action: 'query',
      errorformat: 'plaintext',
      format: 'json',
      formatversion: 2,
    }
    this.defaultOptions = options || {}

    this.requestHandlerRef = computed(() => {
      const instance = MediaWikiApi.createRequestHandler(this.baseURL.value, {
        ...this.defaultOptions,
        query: this.defaultParams as any,
      })
      // Handle cookies for Node.js
      if (!('document' in globalThis)) {
        instance.interceptors.request.use((ctx) => {
          ctx.headers = (ctx.headers as Record<string, string>) || {}
          ctx.headers['cookie'] = Object.keys(this.cookies)
            .map((name) => `${name}=${this.cookies[name]}`)
            .join(';')
          return ctx
        })
        instance.interceptors.response.use((ctx) => {
          const cookieHeaders = (ctx.rawResponse!.headers as Headers).get(
            'set-cookie'
          )
          const rawCookies = cookieHeaders?.split(',').map((i) => i.trim())
          rawCookies?.forEach((i) => {
            const [name, ...value] = i.split(';')[0].split('=')
            this.cookies[name] = value.join('=')
          })
          return ctx
        })
      }

      return instance
    })
  }

  static normalizeParamValue(item: MwApiParams[keyof MwApiParams]) {
    if (Array.isArray(item)) {
      return item.join('|')
    } else if (typeof item === 'boolean') {
      return item ? '1' : undefined
    } else if (typeof item === 'number') {
      return '' + item
    } else {
      return item
    }
  }
  static createRequestHandler(
    baseURL: string,
    options: Partial<FexiosRequestOptions> = {}
  ) {
    const instance = new Fexios(options)
    instance.baseConfigs.baseURL = baseURL

    // Adjust body
    instance.on('beforeInit', (ctx) => {
      if (ctx.method?.toLowerCase() !== 'post') {
        return ctx
      }

      if (
        typeof ctx.body === 'object' &&
        ctx.body !== null &&
        !(ctx.body instanceof URLSearchParams) &&
        !(ctx.body instanceof FormData)
      ) {
        const body: any = ctx.body
        Object.keys(body).forEach((key) => {
          const data = MediaWikiApi.normalizeParamValue(body[key])
          if (typeof data === 'undefined' || data === null) {
            delete body[key]
          } else if (data !== body[key]) {
            body[key] = data
          }
        })
        ctx.body = new URLSearchParams(ctx.body as any)
      }

      if (
        (globalThis.FormData && ctx.body instanceof FormData) ||
        ctx.body instanceof URLSearchParams
      ) {
        const body = ctx.body
        // Adjust params
        body.forEach((value, key) => {
          const data = MediaWikiApi.normalizeParamValue(value)
          if (typeof data === 'undefined' || data === null) {
            body.delete(key)
          } else if (data !== value) {
            body.set(key, data as any)
          }
        })
        // Adjust query
        const searchParams = new URLSearchParams(ctx.query as any)
        !searchParams.has('format') &&
          searchParams.set('format', '' + (body.get('format') || 'json'))
        !searchParams.has('formatversion') &&
          searchParams.set(
            'formatversion',
            '' + (body.get('formatversion') || '2')
          )
        body.has('origin') &&
          searchParams.set('origin', '' + body.get('origin'))
        ctx.query = Object.fromEntries(searchParams)
      }

      return ctx
    })

    // Adjust query
    instance.on('beforeInit', (ctx) => {
      ctx.query = ctx.query as Record<string, any>
      for (const key in ctx.query) {
        const data = MediaWikiApi.normalizeParamValue(ctx.query[key])
        if (typeof data === 'undefined' || data === null) {
          delete ctx.query[key]
        } else if (data !== ctx.query[key]) {
          ctx.query[key] = '' + data
        }
      }
      return ctx
    })

    // Adjust origin param
    instance.on('beforeRequest', (ctx) => {
      const url = new URL(ctx.url!)
      if (url.searchParams.has('origin')) {
        const origin = encodeURIComponent(
          url.searchParams.get('origin') || ''
        ).replace(/\./g, '%2E')
        ctx.query = {}
        url.searchParams.delete('origin')
        ctx.url = `${url}${url.search ? '&' : '?'}origin=${origin}`
      }
      return ctx
    })

    return instance
  }

  /** Syntactic Sugar */
  // request handler
  get request() {
    return this.requestHandlerRef.value
  }
  // userOptions
  get defaultOptions() {
    return this.defaultOptionsRef.value
  }
  set defaultOptions(options: Partial<FexiosConfigs>) {
    this.defaultOptionsRef.value = options
  }
  // defaultParams
  get defaultParams() {
    return this.defaultParamsRef.value
  }
  set defaultParams(params: MwApiParams) {
    this.defaultParamsRef.value = params
  }

  /** Base methods encapsulation */
  get<T = any>(query: MwApiParams, options?: FexiosRequestOptions) {
    return this.request.get<T>('', {
      query: query as any,
      ...options,
    })
  }
  post<T = any>(
    data: MwApiParams | URLSearchParams | FormData,
    options?: FexiosRequestOptions
  ) {
    return this.request.post<T>('', data, options)
  }

  async login(
    lgname: string,
    lgpassword: string,
    params?: MwApiParams,
    options?: { retry?: number; noCache?: boolean }
  ): Promise<{
    result: 'Success' | 'NeedToken' | 'WrongToken' | 'Failed'
    token?: string
    reason?: {
      code: string
      text: string
    }
    lguserid: number
    lgusername: string
  }> {
    this.defaultOptions.credentials = 'include'
    const { data } = await this.postWithToken(
      'login',
      {
        action: 'login',
        lgname,
        lgpassword,
        ...params,
      },
      { tokenName: 'lgtoken', ...options }
    )
    if (data?.login?.result !== 'Success') {
      throw new Error(
        data?.login?.reason?.text || data?.login?.result || 'Login failed'
      )
    }
    return data.login
  }
  async getUserInfo() {
    const { data } = await this.get<{
      query: {
        userinfo: {
          id: number
          name: string
          groups: string[]
          rights: string[]
          blockid?: number
          blockedby?: string
          blockedbyid?: number
          blockreason?: string
          blockexpiry?: string
          blockedtimestamp?: string
        }
      }
    }>({
      action: 'query',
      meta: 'userinfo',
      uiprop: ['groups', 'rights', 'blockinfo'],
    })
    return data?.query?.userinfo
  }

  /** Token Handler */
  async getTokens(type: MwTokenName[] = ['csrf']) {
    this.defaultOptions.credentials = 'include'
    const { data } = await this.get({
      action: 'query',
      meta: 'tokens',
      type,
    })
    this.tokens = { ...this.tokens, ...data.query.tokens }
    return this.tokens
  }
  async token(type: MwTokenName = 'csrf', noCache = false) {
    if (!this.tokens[`${type}token`] || noCache) {
      delete this.tokens[`${type}token`]
      await this.getTokens([type])
    }
    return this.tokens[`${type}token`]
  }

  async postWithToken<T = any>(
    tokenType: MwTokenName,
    body: MwApiParams,
    options?: { tokenName?: string; retry?: number; noCache?: boolean }
  ): Promise<FexiosFinalContext<T>> {
    const { tokenName = 'token', retry = 3, noCache = false } = options || {}
    if (retry < 1) {
      return Promise.reject({
        error: {
          code: 'WIKI_SAIKOU_TOKEN_RETRY_LIMIT_EXCEEDED',
          info: 'The limit of the number of times to automatically re-acquire the token has been exceeded',
        },
      })
    }
    const token = await this.token(tokenType, noCache)
    return this.post<T>({
      [tokenName]: token,
      ...body,
    })
      .catch(({ data }) => {
        if (
          [data?.errors?.[0].code, data?.error?.code].includes('badtoken') ||
          ['NeedToken', 'WrongToken'].includes(data?.login?.result)
        ) {
          return this.postWithToken(tokenType, body, {
            tokenName,
            retry: retry - 1,
            noCache: true,
          })
        }
        return Promise.reject(data)
      })
      .finally(() => {
        delete this.tokens[`${tokenType}token`]
      })
  }
  postWithEditToken<T = any>(body: MwApiParams) {
    return this.postWithToken<T>('csrf', body)
  }

  async getMessages(ammessages: string[], amlang = 'zh', options: MwApiParams) {
    const { data } = await this.get({
      action: 'query',
      meta: 'allmessages',
      ammessages,
      amlang,
      ...options,
    })
    const result: Record<string, string> = {}
    data.query.allmessages.forEach(function (obj: {
      missing?: boolean
      name: string
      content: string
    }) {
      if (!obj.missing) {
        result[obj.name] = obj.content
      }
    })
    return result
  }

  async parseWikitext(
    wikitext: string,
    title?: string,
    extraBody?: MwApiParams,
    options?: FexiosRequestOptions
  ): Promise<string> {
    const { data } = await this.post(
      {
        action: 'parse',
        title,
        text: wikitext,
        ...extraBody,
      },
      options
    )
    return data.parse.text
  }
}

export class MediaWikiForeignApi extends MediaWikiApi {
  constructor(baseURL?: string, options?: Partial<FexiosConfigs>) {
    super(baseURL, {
      credentials: 'include',
      ...options,
    })
    this.defaultParams.origin = location.origin
  }
}

// Aliases
export default MediaWikiApi
export { MediaWikiApi as MwApi, MediaWikiForeignApi as ForeignApi }

// Types
export type MwApiParams = Record<
  string,
  string | number | string[] | undefined | boolean | File
>
export type MwTokenName =
  | 'createaccount'
  | 'csrf'
  | 'login'
  | 'patrol'
  | 'rollback'
  | 'userrights'
  | 'watch'
