import * as vscode from 'vscode'

interface DebuggerState {
    [language: string]: {
        [sessionId: string]: {
            hitBreakpoints: number
            initialized: boolean
        }
    }
}

interface DebugDisposables {
    d: vscode.Disposable
    l: string
}

export async function activate(context: vscode.ExtensionContext) {
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

    function createDebugAdapterTracker(session: vscode.DebugSession) {
		if (!debugStates[session.configuration.type]) {
			debugStates[session.configuration.type] = {}
		}

        debugStates[session.configuration.type][session.id] = {
            hitBreakpoints: 0,
            initialized: false,
        }

        return {
            async onWillReceiveMessage(message: any) {
                if (message.type === 'request' && message.command === 'setExceptionBreakpoints') {
                }
            },
            async onDidSendMessage(message: any) {
                if (message.type === 'response' && message.command === 'attach') {
                    await session.customRequest('setExceptionBreakpoints', {
                        filters: [],
                        filterOptions: [],
                    })
                }

                if (message.type === 'event' && message.event === 'stopped') {
                    debugStates[session.configuration.type][session.id].hitBreakpoints += 1
                    if (debugStates[session.configuration.type][session.id].hitBreakpoints === 1) {
                        await session.customRequest('setExceptionBreakpoints', {
                            filters: ['all'],
                            filterOptions: [],
                        })

                        await session.customRequest('continue', {})
                    }
                }
            },
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('debug-my-code.add-language', async () => {
            const config = vscode.workspace.getConfiguration('debug-my-code')
            const currentLanguages = config.get('languages') as string[]
            if (!currentLanguages) {
                await config.update('languages', [], vscode.ConfigurationTarget.Workspace)
            }

            const selectedLanguage = await vscode.window.showQuickPick(
                getAllDebugTypes().filter((l) => !currentLanguages.includes(l)),
                {
                    placeHolder: 'Select a language to add',
                    title: 'Select a language to add to Debug My Code.',
                },
            )
            if (!selectedLanguage) {
                return
            }

            currentLanguages.push(selectedLanguage.detail)
            await config.update('languages', currentLanguages, vscode.ConfigurationTarget.Workspace)

            const provider = vscode.debug.registerDebugAdapterTrackerFactory(selectedLanguage, {
                createDebugAdapterTracker,
            })
            context.subscriptions.push(provider)
            debugDisposables.push({
                d: provider,
                l: selectedLanguage,
            })
        }),
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('debug-my-code.remove-language', async () => {
            const config = vscode.workspace.getConfiguration('debug-my-code')
            const currentLanguages = config.get('languages') as string[]
            if (!currentLanguages) {
                await config.update('languages', [], vscode.ConfigurationTarget.Workspace)
                await vscode.window.showInformationMessage('No languages to remove.')
                return
            }

            const allLanguages = getAllDebugTypes()

            const selectedLanguage = await vscode.window.showQuickPick(
                currentLanguages.map((l) => allLanguages.find((a) => a.detail === l)),
            )
            if (!selectedLanguage) {
                return
            }

            currentLanguages.splice(currentLanguages.indexOf(selectedLanguage), 1)
            await config.update('languages', currentLanguages, vscode.ConfigurationTarget.Workspace)
            await vscode.window.showInformationMessage(`Language ${selectedLanguage} removed.`)

            const disposable = debugDisposables.find((d) => d.l === selectedLanguage)
            if (disposable) {
                context.subscriptions.find((d) => d === disposable.d)?.dispose()
                debugDisposables.splice(debugDisposables.indexOf(disposable), 1)
            }
        }),
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('debug-my-code.disable', async () => {
            const config = vscode.workspace.getConfiguration('debug-my-code')

			if(!config.get('enabled')) {

				if(debugDisposables.length === 0) {
					for (const s of debugDisposables) {
						context.subscriptions.find((d) => d === s.d)?.dispose()
					}
					debugDisposables = []
				}

				await vscode.window.showInformationMessage('Debug My Code is already disabled.')
				return
			}

            const languages = config.get('languages') as string[]
            if (languages && languages.length > 1) {
                const pick = await vscode.window.showQuickPick([
                    'Disable Debug My Code in this workspace',
                    'Disable Debug My Code for a specific language',
                ])
                if (!pick) {
                    return
                }

                if (pick === 'Disable Debug My Code for a specific language') {
                 	return await vscode.commands.executeCommand('debug-my-code.remove-language')
                } else if (pick === 'Disable Debug My Code in this workspace') {
                    await config.update('enabled', [], vscode.ConfigurationTarget.Workspace)
                }
            }

			for (const s of debugDisposables) {
				context.subscriptions.find((d) => d === s.d)?.dispose()
			}
			debugDisposables = []

			await config.update('enabled', false, vscode.ConfigurationTarget.Workspace)
        }),
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('debug-my-code.enable', async () => {
            const config = vscode.workspace.getConfiguration('debug-my-code')

			if(config.get('enabled')) {
				await vscode.window.showInformationMessage('Debug My Code is already enabled.')
				return
			}

            let languages = config.get('languages') as string[]

            if (!languages || !languages.length) {
                await vscode.commands.executeCommand('debug-my-code.add-language')
            }

            languages = config.get('languages') as string[]
            if (!languages || !languages.length) {
                return
            }

            await config.update('enabled', true, vscode.ConfigurationTarget.Workspace)
        }),
    )

    if (!vscode.workspace.getConfiguration('debug-my-code').get('enabled')) {
        return
    }

    const languages = vscode.workspace.getConfiguration('debug-my-code').get('languages') as string[]
    if (!languages || !languages.length) {
        const result = await vscode.window.showErrorMessage(
            'Please configure the languages you want to use for Debug-My-Code in your VSCode settings JSON.',
            'Add Language',
            'Disable extension',
        )

        if (result === 'Add Language') {
            await vscode.commands.executeCommand('debug-my-code.add-language')
        }

        if (result === 'Disable extension') {
            await vscode.commands.executeCommand('debug-my-code.disable')
        }
        return
    }

    for (const language of languages) {
        const provider = vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker,
        })
        context.subscriptions.push(provider)
        debugDisposables.push({
            d: provider,
            l: language,
        })
    }
}

export function deactivate() {}
