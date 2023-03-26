import * as vscode from 'vscode'

interface DebuggerState {
    [language: string]: {
        [sessionId: string]: {
            hitBreakpoint: boolean
            exceptionBreakpoints: string[] | null
        }
    }
}

const CMD_DISABLE = 'debug-my-code.disable'
const CMD_ENABLE = 'debug-my-code.enable'
const CMD_LANGUAGE = 'debug-my-code.language'
type CMD = typeof CMD_DISABLE | typeof CMD_ENABLE | typeof CMD_LANGUAGE

const CTX_ENABLED = 'debug-my-code.enabled'
type CTX = typeof CTX_ENABLED

const CNF_ENABLED = 'enabled'
const CNF_LANGUAGES = 'languages'
type CNF = typeof CNF_ENABLED | typeof CNF_LANGUAGES

const getConfig = () => vscode.workspace.getConfiguration('debug-my-code')
const getSubConfig = async (key: CNF, config?: vscode.WorkspaceConfiguration): Promise<any> => {
    if (!config) {
        return await vscode.workspace.getConfiguration('debug-my-code').get(key)
    }
    return await config.get(key)
}
const setConfig = async (key: CNF, value: any, config?: vscode.WorkspaceConfiguration): Promise<void> => {
    if (!config) {
        return await vscode.workspace
            .getConfiguration('debug-my-code')
            .update(key, value, vscode.ConfigurationTarget.Workspace)
    }
    return await config.update(key, value, vscode.ConfigurationTarget.Workspace)
}

const setContext = async (key: CTX, value: any) => {
    return await vscode.commands.executeCommand('setContext', key, value)
}

const runCommand = async (command: CMD, args?: any) => {
    return await vscode.commands.executeCommand(command, args)
}

interface DebugDisposables {
    d: vscode.Disposable
    l: string
}

export async function activate(context: vscode.ExtensionContext) {
    {
        const enabled = await getSubConfig(CNF_ENABLED)
        await setContext(CTX_ENABLED, enabled)
    }

    let debugStates: DebuggerState = {}
    let debugDisposables: DebugDisposables[] = []

    function getAllDebugTypes(): any[] {
        const debugTypes: vscode.QuickPickItem[] = []

        for (const extension of vscode.extensions.all) {
            const debuggersContribution =
                extension.packageJSON.contributes && extension.packageJSON.contributes.debuggers

            if (debuggersContribution) {
                for (const debuggerContribution of debuggersContribution) {
                    if (
                        debuggerContribution.type &&
                        debuggerContribution.type !== '*' &&
                        !debugTypes.find((d) => d.detail === debuggerContribution.type)
                    ) {
                        debugTypes.push({
                            label: debuggerContribution.label,
                            description: extension.packageJSON.displayName,
                            detail: debuggerContribution.type,
                        })
                    }
                }
            }
        }

        return Array.from(debugTypes)
    }

    async function createDebugAdapterTracker(session: vscode.DebugSession): Promise<vscode.DebugAdapterTracker | undefined> {
        const config = getConfig()
        const enabled = await getSubConfig(CNF_ENABLED, config)
        const languages = (await getSubConfig(CNF_LANGUAGES, config)) as string[]

        if (!enabled || !languages.includes(session.configuration.type)) {
            return
        }

        if (!debugStates[session.configuration.type]) {
            debugStates[session.configuration.type] = {}
        }

        debugStates[session.configuration.type][session.id] = {
            hitBreakpoint: false,
            exceptionBreakpoints: null,
        }

        return {
            async onWillReceiveMessage(message: any) {
                if (message.type === 'request' && message.command === 'setExceptionBreakpoints') {
                    if (!debugStates[session.configuration.type][session.id].exceptionBreakpoints) {
                        debugStates[session.configuration.type][session.id].exceptionBreakpoints =
                            message.arguments.filterOptions
                    }
                }
            },
            async onDidSendMessage(message: any) {
                if (message.type === 'response' && (message.command === 'attach' || message.command === 'launch')) {
                    await session.customRequest('setExceptionBreakpoints', {
                        filters: [],
                        filterOptions: [],
                    })
                }

                if (message.type === 'event' && message.event === 'stopped' && message.body.reason === 'breakpoint') {
                    if (!debugStates[session.configuration.type][session.id].hitBreakpoint) {
                        debugStates[session.configuration.type][session.id].hitBreakpoint = true

                        message.type = ""
                        message.event = ""
                        message.body = {}

                        await session.customRequest('setExceptionBreakpoints', {
                            filters: [],
                            filterOptions: debugStates[session.configuration.type][session.id].exceptionBreakpoints,
                        })

                        await session.customRequest('continue', {})
                    }
                }
            },
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_LANGUAGE, async () => {
            const config = getConfig()
            const currentLanguages = (await getSubConfig(CNF_LANGUAGES, config)) as string[]
            if (!currentLanguages) {
                await setConfig(CNF_LANGUAGES, [], config)
            }

            const selectedLanguage = await vscode.window.showQuickPick(
                getAllDebugTypes().map((d) => (currentLanguages.includes(d.detail) ? { ...d, picked: true } : d)),
                {
                    placeHolder: 'Select a language to add',
                    title: 'Select a language to add to Debug My Code.',
                    canPickMany: true,
                },
            )
            if (!selectedLanguage) {
                return
            }

            currentLanguages.length = 0
            currentLanguages.push(...selectedLanguage.map((s) => s.detail))
            await setConfig(CNF_LANGUAGES, currentLanguages, config)

            const removedLanguages = debugDisposables.filter((d) => !currentLanguages.includes(d.l))
            for (const s of removedLanguages) {
                context.subscriptions.find((d) => d === s.d)?.dispose()
                debugDisposables.splice(debugDisposables.indexOf(s), 1)
            }

            const addedLanguages = selectedLanguage.filter((s) => !debugDisposables.find((d) => d.l === s.detail))
            for (const s of addedLanguages) {
                const provider = vscode.debug.registerDebugAdapterTrackerFactory(s.detail, {
                    createDebugAdapterTracker,
                })
                context.subscriptions.push(provider)
                debugDisposables.push({
                    d: provider,
                    l: s.detail,
                })
            }
        }),
    )

    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_DISABLE, async () => {
            const config = getConfig()

            if (!(await getSubConfig(CNF_ENABLED, config))) {
                if (debugDisposables.length === 0) {
                    for (const s of debugDisposables) {
                        context.subscriptions.find((d) => d === s.d)?.dispose()
                    }
                    debugDisposables = []
                }

                await vscode.window.showInformationMessage('Debug My Code is already disabled.')
                await setContext(CTX_ENABLED, false)
                return
            }

            const languages = (await config.get('languages')) as string[]
            if (languages && languages.length > 1) {
                const pick = await vscode.window.showQuickPick([
                    'Disable Debug My Code in this workspace',
                    'Disable Debug My Code for a specific language',
                ])
                if (!pick) {
                    return
                }

                if (pick === 'Disable Debug My Code for a specific language') {
                    return await runCommand(CMD_LANGUAGE)
                } else if (pick === 'Disable Debug My Code in this workspace') {
                    await setConfig(CNF_ENABLED, false, config)
                }
            }

            for (const s of debugDisposables) {
                context.subscriptions.find((d) => d === s.d)?.dispose()
            }
            debugDisposables = []

            await setContext(CTX_ENABLED, false)
            await setConfig(CNF_ENABLED, false, config)
        }),
    )

    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_ENABLE, async () => {
            const config = getConfig()
            await setConfig(CNF_ENABLED, true, config)
            await setContext(CTX_ENABLED, true)

            const languages = (await getSubConfig(CNF_LANGUAGES, config)) as string[]

            for (const language of languages) {
                const provider = vscode.debug.registerDebugAdapterTrackerFactory(language, {
                    createDebugAdapterTracker,
                })
                context.subscriptions.push(provider)
                debugDisposables.push({
                    d: provider,
                    l: language,
                })
            }
        }),
    )

    {
        const enabled = await getSubConfig(CNF_ENABLED)
        await setContext(CTX_ENABLED, enabled)

        if (!enabled) {
            return
        }
        const languages = (await getSubConfig(CNF_LANGUAGES)) as string[]
        if (!languages || !languages.length) {
            return
        }

        for (const language of languages) {
            const provider = vscode.debug.registerDebugAdapterTrackerFactory(language, {
                createDebugAdapterTracker,
            })
            context.subscriptions.push(provider)
            debugDisposables.push({
                d: provider,
                l: language,
            })
        }
    }
}

export function deactivate() {}
