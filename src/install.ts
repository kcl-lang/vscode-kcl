import * as vscode from 'vscode';
import {outputChannel} from './kclStatus';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs';
import { Readable } from 'node:stream';

const KCL_PATH = path.join(os.homedir(), '.kcl');
const KPM_PATH = path.join(KCL_PATH, 'kpm');
const KPM_BIN_PARTH = path.join(KPM_PATH, 'bin');
const GIT_ORG = 'kcl-lang';
const KCL_REPO = 'kcl';
const RELEASE_BASE_URL = `https://github.com/${GIT_ORG}/${KCL_REPO}/releases/download`;
export const KCL_LANGUAGE_SERVER = 'kcl-language-server';

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

	const installingMsg = `Installing ${KCL_LANGUAGE_SERVER} to ${KPM_BIN_PARTH}`;
	outputChannel.appendLine(installingMsg);

	// get download url and install path
	const downloadUrl = await getReleaseURL(KCL_LANGUAGE_SERVER);
	if (!downloadUrl) {
		return;
	}
	const installPath = getInstallPath(KCL_LANGUAGE_SERVER);
	
	// remove old version if exists
	outputChannel.appendLine(`2. Removing old version from ${installPath}`);
	fs.rmSync(installPath, {force: true});

	// create .kcl/kpm/bin directory if not exists
	fs.mkdirSync(KPM_BIN_PARTH, {recursive: true});

	// download binary to install path
	if (!await downloadToLocal(downloadUrl, installPath)) {
		return;
	}
	
	// garantee executable permission
	fs.chmodSync(installPath, '755');

	// separate line
	outputChannel.appendLine('');
	return installPath;
	
	// todo: gurantee to restart language server each time after installation
	// todo: add KPM_BIN_PARTH to $PATH
}

export async function downloadToLocal(releaseURL: string, installPath: string): Promise<boolean> {
	outputChannel.appendLine(`3. Fetching latest version from ${releaseURL}`);
	// todo: support retry when got http code 403
	try {
		const resp = await axios.get<Readable>(releaseURL, {responseType: 'stream'});
		if (resp.status !== axios.HttpStatusCode.Ok) {
			outputChannel.appendLine(`3. Failed to fetch latest version: ${resp.statusText}. Please download manually from ${releaseURL}`);
			return false;
		}
		const writer = fs.createWriteStream(installPath);
		resp.data.pipe(writer);
		// todo: show progress bar of download process
		return new Promise<boolean>((resolve, reject) => {
			writer.on('finish', ()=>{
				outputChannel.appendLine(`4. Successfully installed to ${installPath}`);
				resolve(true);
			});
			writer.on('error', (error)=>{
				outputChannel.appendLine(`4. Failed to download binary: ${error.message}`);
				reject(false);
			});
		});
	} catch (error) {
		outputChannel.appendLine(`3. Failed to fetch latest version: ${error}`);
		return false;
	}
	
}

function getInstallPath(toolName: string): string {
	return path.join(KPM_BIN_PARTH, toolName);
}

async function getReleaseURL(toolName: string): Promise<string | undefined> {
	const version = await getLatestRelease();
	if (!version) {
		return;
	}
	outputChannel.appendLine(`1. The latest release version is: ${version}`);
	const binaryName = getBinaryName(toolName, version);
	if (!binaryName) {
		return;
	}
	return `${RELEASE_BASE_URL}/${version}/${binaryName}`;
}

function getBinaryName(toolName: string, version: string): string|undefined {
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
	return `${toolName}-${version}-${os.type()}${archPart}${extension}`;
}

function reportNotSupportError(platform: string, arch: string){
	// todo: add feedback button and link; add build from source link
	outputChannel.appendLine(`No prebuilt binary available for '${platform}'-'${arch}', feedback to us please.`);
}


async function getLatestRelease(): Promise<string|undefined> {
	const releaseAPI=`https://api.github.com/repos/${GIT_ORG}/${KCL_REPO}/releases/latest`;
	try {
		// todo: support retry when got http code 403(usually caused by api rate limit)
		const resp = await axios.get<ReleaseInfo>(releaseAPI);
		if (resp.status !== axios.HttpStatusCode.Ok) {
			outputChannel.appendLine(`Failed to fetch releases from ${releaseAPI}: ${resp.statusText}`);
		}
		return resp.data.tag_name;
	} catch (error) {
		outputChannel.appendLine(`Failed to fetch releases from ${releaseAPI}: ${error}`);
		return;
	}
}

type ReleaseInfo = {
	tag_name: string;
	prerelease: boolean;
};
