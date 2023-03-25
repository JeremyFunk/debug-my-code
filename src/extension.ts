// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    let hitBreakpoints = 0
	
	context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker(session: vscode.DebugSession) {
                return {
                    async onDidSendMessage(message: any) {
                        if (message.type === 'response' && message.command === 'attach') {
                            await session.customRequest('setExceptionBreakpoints', {
                                filters: [],
                                filterOptions: [],
                            })
                        }

                        if(message.type === 'event' && message.event === 'stopped') {
                            hitBreakpoints += 1
                            if(hitBreakpoints === 1) {
                                await session.customRequest('setExceptionBreakpoints', {
                                    filters: ['all'],
                                    filterOptions: [],
                                })

                                await session.customRequest('continue', {})
                            }
                        }
                    },
                    onWillStartSession() {
                        hitBreakpoints = 0
                    },
                }
            },
        }),
    )
}

// This method is called when your extension is deactivated
export function deactivate() {}
