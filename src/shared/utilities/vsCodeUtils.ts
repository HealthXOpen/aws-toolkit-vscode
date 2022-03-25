/*!
 * Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import * as nls from 'vscode-nls'
import globals from '../extensionGlobals'
import { getIdeProperties } from '../extensionUtilities'
import { getLogger } from '../logger/logger'
import { Window } from '../vscode/window'
import { Timeout, waitTimeout, waitUntil } from './timeoutUtils'

// TODO: Consider NLS initialization/configuration here & have packages to import localize from here
export const localize = nls.loadMessageBundle()

export function isFileIconThemeSeti(): boolean {
    const iconTheme = vscode.workspace.getConfiguration('workbench').get('iconTheme')
    return !iconTheme || iconTheme === 'vs-seti'
}

export function fileIconPath(): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
    // Workaround for https://github.com/microsoft/vscode/issues/85654
    // Once this is resolved, ThemeIcons can be used for seti as well
    if (isFileIconThemeSeti()) {
        return {
            dark: vscode.Uri.file(globals.iconPaths.dark.file),
            light: vscode.Uri.file(globals.iconPaths.light.file),
        }
    } else {
        return vscode.ThemeIcon.File
    }
}

export function folderIconPath(): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
    // Workaround for https://github.com/microsoft/vscode/issues/85654
    // Once this is resolved, ThemeIcons can be used for seti as well
    if (isFileIconThemeSeti()) {
        return {
            dark: vscode.Uri.file(globals.iconPaths.dark.folder),
            light: vscode.Uri.file(globals.iconPaths.light.folder),
        }
    } else {
        return vscode.ThemeIcon.Folder
    }
}

/**
 * Executes the close all editors command and waits for all visible editors to disappear
 */
export async function closeAllEditors() {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')

    // The output channel counts as an editor, but you can't really close that...
    const noVisibleEditor: boolean | undefined = await waitUntil(
        async () => {
            const visibleEditors = vscode.window.visibleTextEditors.filter(
                editor => !editor.document.fileName.includes('extension-output') // Output channels are named with the prefix 'extension-output'
            )

            return visibleEditors.length === 0
        },
        {
            timeout: 2500, // Arbitrary values. Should succeed except when VS Code is lagging heavily.
            interval: 250,
            truthy: true,
        }
    )

    if (!noVisibleEditor) {
        throw new Error(
            `Editor "${
                vscode.window.activeTextEditor!.document.fileName
            }" was still open after executing "closeAllEditors"`
        )
    }
}

/**
 * Checks if an extension is installed and active.
 */
export function isExtensionActive(extId: string): boolean {
    const extension = vscode.extensions.getExtension(extId)
    return !!extension && extension.isActive
}

/**
 * Checks if an extension is installed, and shows a message if not.
 */
export function isExtensionInstalledMsg(
    extId: string,
    extName: string,
    feat?: string,
    window: Window = globals.window
): boolean {
    if (vscode.extensions.getExtension(extId)) {
        return true
    }
    feat = feat ? feat : `${getIdeProperties().company} Toolkit`
    const msg = localize(
        'AWS.missingExtension',
        '{0} requires the {1} extension ({2}) to be installed and enabled.',
        feat,
        extName,
        extId
    )

    const installBtn = localize('AWS.missingExtension.install', 'Install...')
    const items = [installBtn]

    const p = window.showErrorMessage(msg, ...items)
    p.then<string | undefined>(selection => {
        if (selection === installBtn) {
            vscode.commands.executeCommand('extension.open', extId)
        }
        return selection
    })
    return false
}

/**
 * Activates an extension and returns it, or does nothing if the extension is
 * not installed.
 *
 * @param extId Extension id
 * @param silent Return undefined on failure, instead of throwing
 * @returns Extension, or undefined on failure if `silent`
 */
export async function activateExtension<T>(
    extId: string,
    silent: boolean = true
): Promise<vscode.Extension<T> | undefined> {
    let loggerInitialized: boolean
    try {
        getLogger()
        loggerInitialized = true
    } catch {
        loggerInitialized = false
    }
    function log(s: string, ...rest: any[]): void {
        if (loggerInitialized) {
            getLogger().debug(s, ...rest)
        } else {
            console.log(s, ...rest)
        }
    }

    const extension = vscode.extensions.getExtension<T>(extId)
    if (!extension) {
        if (silent) {
            return undefined
        }
        throw new Error(`Extension not found: ${extId}`)
    }

    if (!extension.isActive) {
        log('Activating extension: %s', extId)
        try {
            const activate = (async () => {
                await extension.activate()
                log('Extension activated: %s', extId)
                return vscode.extensions.getExtension<T>(extId)
            })()

            return await waitTimeout(activate, new Timeout(60000))
        } catch (err) {
            log('Extension failed to activate: %s: %O', extId, err as Error)
            if (!silent) {
                throw err
            }
            return undefined
        }
    }

    return extension
}

/**
 * Convenience function to make a Thenable into a Promise.
 */
export function promisifyThenable<T>(thenable: Thenable<T>): Promise<T> {
    return new Promise((resolve, reject) => thenable.then(resolve, reject))
}
