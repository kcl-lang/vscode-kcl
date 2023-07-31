import * as vscode from 'vscode';
import {outputChannel} from './kclStatus';
import * as os from 'os';
import * as path from 'path';
import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as shelljs from 'shelljs';

const KCL_PATH = path.join(os.homedir(), '.kcl');
const KPM_PATH = path.join(KCL_PATH, 'kpm');
const KPM_BIN_PATH = path.join(KPM_PATH, 'bin');
const GIT_ORG = 'kcl-lang';
const KCL_REPO = 'kcl';
export const RELEASE_BASE_URL = `https://github.com/${GIT_ORG}/${KCL_REPO}/releases/download`;
export const KCL_LANGUAGE_SERVER = 'kcl-language-server';

let installMsgs = '';

export function outputMsg(msg: string, append = true) {
	if (append){
		installMsgs += msg + '\n';
		outputChannel.replace(installMsgs);
	} else {
		outputChannel.replace(installMsgs + msg);
	}
}

export function kcl_rust_lsp_installed(): boolean {
	// note: start from kcl 0.4.6 the kcl-language-server binary is renamed to kcl-language-server
	// the old kcl-lsp binary will be deprecated
	return shelljs.which("kcl-language-server") ? true : false;
}

export async function promptInstallLanguageServer(): Promise<string | undefined> {
	const installOptions = ['Install', 'Cancel'];
	const selected = await vscode.window.showErrorMessage(
		`The kcl-language-server is required for KCL code intelliSense. Install now?`,
		...installOptions
	);
	switch(selected) {
		case 'Install':
			return installLanguageServer();
		default:
			return;
	}
}


export async function installLanguageServer(): Promise<string | undefined> {
	outputChannel.show();
	outputChannel.clear();

	const installingMsg = `Installing ${KCL_LANGUAGE_SERVER} to ${KPM_BIN_PATH}`;
	outputChannel.appendLine(installingMsg);

	// get download url and install path
	const downloadUrl = await getReleaseURL(KCL_LANGUAGE_SERVER);
	if (!downloadUrl) {
		return;
	}
	const installPath = getInstallPath(KCL_LANGUAGE_SERVER);
	
	// remove old version if exists
	outputMsg(`2. Removing old version from ${installPath}`);
	fs.rmSync(installPath, {force: true});

	// create .kcl/kpm/bin directory if not exists
	fs.mkdirSync(KPM_BIN_PATH, {recursive: true});

	// download binary to install path
	if (!await downloadToLocal(downloadUrl, installPath)) {
		return;
	}
	
	// garantee executable permission
	fs.chmodSync(installPath, '755');

	// separate line
	outputMsg('');

	return installPath;
	
	// todo: gurantee to restart language server each time after installation
	// todo: add KPM_BIN_PARTH to $PATH
}

export async function downloadToLocal(releaseURL: string, installPath: string): Promise<boolean> {
	outputMsg(`3. Fetching latest version from ${releaseURL}`);
	let downloadEnd = false;
	return new Promise<boolean>((resolve, reject) => {
		try {
			axios({
				url: releaseURL,
				responseType: 'stream',
			}).then((response: AxiosResponse<any>) => {
				// verify the reponse status
				if (response.status !== axios.HttpStatusCode.Ok) {
					downloadEnd = true;
					outputMsg(`3. Failed to fetch latest version: ${response.statusText}. Please download manually from ${releaseURL} and place it to ${installPath}`);
					resolve(false);
				}
				const file = fs.createWriteStream(installPath);
				let downloadedSize = 0;
		
				// listen to the data event, write each chunk to file
				response.data.on('data', (chunk: any) => {
					file.write(chunk);
					downloadedSize += chunk.length;
		
					// compute and show progress
					const totalSize = response.headers['content-length'];
					const percent = ((downloadedSize / totalSize) * 100).toFixed(2);
					if (!downloadEnd) {
						outputMsg(`${downloadedSize} bytes received(${percent}%)`, false);
					}
				});
		
				// listen to the end event
				response.data.on('end', () => {
					downloadEnd = true;
					outputMsg(`4. Successfully installed to ${installPath}`);
					
					file.end();
					resolve(true);
				});
		
				// listen to the error event
				response.data.on('error', (err: Error) => {
					downloadEnd = true;
					outputMsg(`4. Failed to download binary: ${err.message}`);
					// delete local tmp file
					fs.unlinkSync(installPath);
					resolve(false);
				});
			});
		} catch (error) {
			downloadEnd = true;
			outputMsg(`3. Failed to fetch latest version: ${error}`);
			resolve(false);
		}
	});
}

export function getInstallPath(toolName: string): string {
	return path.join(KPM_BIN_PATH, toolName);
}

async function getReleaseURL(toolName: string): Promise<string | undefined> {
	const version = await getLatestRelease();
	if (!version) {
		return;
	}
	outputMsg(`1. The latest release version is: ${version}`);
	const binaryName = getBinaryName(toolName, version);
	if (!binaryName) {
		return;
	}
	return `${RELEASE_BASE_URL}/${version}/${binaryName}`;
}

export function getBinaryName(toolName: string, version: string): string|undefined {
	const platform = os.type() === 'Windows_NT' ? 'windows' : os.type().toLowerCase();
	const archType = os.arch();
	let arch: string;
	switch (platform) {
		case 'darwin':
			switch(os.arch()) {
				case 'x64':
					arch = 'amd64';
					break;
				case 'arm64':
					arch = 'arm64';
					break;
				default:
					reportNotSupportError(platform, archType);
					return;
			}
			break;
		case 'linux':
			switch(os.arch()) {
				case 'x64':
					arch = 'amd64';
					break;
				default:
					reportNotSupportError(platform, archType);
					return;
			}
			break;
		case 'windows':
			switch(os.arch()) {
				case 'x64':
					arch = '';
					break;
				default:
					reportNotSupportError(platform, archType);
					return;
			}
			break;
		default:
			reportNotSupportError(platform, archType);
			return;
	}
	
	const extension = platform === 'windows' ? '.exe' : '';
	const archPart = arch ? `-${arch}` : '';
	return `${toolName}-${version}-${platform}${archPart}${extension}`;
}

function reportNotSupportError(platform: string, arch: string){
	// todo: add feedback button and link; add build from source link
	outputMsg(`No prebuilt binary available for '${platform}'-'${arch}', feedback to us please.`);
}


async function getLatestRelease(): Promise<string|undefined> {
	const releaseAPI=`https://api.github.com/repos/${GIT_ORG}/${KCL_REPO}/releases/latest`;
	try {
		// todo: support retry when got http code 403(usually caused by api rate limit)
		const resp = await axios.get<ReleaseInfo>(releaseAPI);
		if (resp.status !== axios.HttpStatusCode.Ok) {
			outputMsg(`Failed to fetch releases from ${releaseAPI}: ${resp.statusText}`);
		}
		return resp.data.tag_name;
	} catch (error) {
		outputMsg(`Failed to fetch releases from ${releaseAPI}: ${error}`);
		return;
	}
}

type ReleaseInfo = {
	tag_name: string;
	prerelease: boolean;
};
