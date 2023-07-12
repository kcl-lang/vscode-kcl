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
	const installOptions = ['Install'];
	const selected = await vscode.window.showErrorMessage(
		`The kcl-language-server is needed for KCL code intelliSense`,
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

	const installingMsg = `Installing ${KCL_LANGUAGE_SERVER} to ${KPM_BIN_PARTH}...`;
	outputChannel.appendLine(installingMsg);

	// get download url and install path
	const downloadFromUrl = await getReleaseURL(KCL_LANGUAGE_SERVER);
	if (!downloadFromUrl) {
		return;
	}
	const installPath = getInstallPath(KCL_LANGUAGE_SERVER);
	
	// remove old version if exists
	fs.rmSync(installPath, {force: true});

	// create .kcl/kpm/bin directory if not exists
	fs.mkdirSync(KPM_BIN_PARTH, {recursive: true});

	// download binary to install path
	if (!await downloadToLocal(downloadFromUrl, installPath)) {
		return;
	}
	
	// garantee executable permission
	fs.chmodSync(installPath, '755');
	return installPath;
	
	// todo: restart language server each time after installation
	// todo: add KPM_BIN_PARTH to $PATH
}

export async function downloadToLocal(releaseURL: string, installPath: string): Promise<boolean> {
	const resp = await axios.get<Readable>(releaseURL, {responseType: 'stream'});
	const writer = fs.createWriteStream(installPath);
	resp.data.pipe(writer);
	return new Promise<boolean>((resolve, reject) => {
		writer.on('finish', ()=>{
			outputChannel.appendLine(`Successfully downloaded to ${installPath}`);
			resolve(true);
		});
		writer.on('error', (error)=>{
			outputChannel.appendLine(`Download failed: ${error.message}`);
			reject(false);
		});
	});
}

type DownloadAssetResp = {
	data: any;
};

function getInstallPath(toolName: string): string {
	return path.join(KPM_BIN_PARTH, toolName);
}

async function getReleaseURL(toolName: string): Promise<string | undefined> {
	const version = await getLatestRelease();
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


async function getLatestRelease(): Promise<string> {
	const releaseAPI=`https://api.github.com/repos/${GIT_ORG}/${KCL_REPO}/releases`;
    const resp = await axios.get<ReleaseInfo[]>(releaseAPI);
    if (resp.status !== axios.HttpStatusCode.Ok) {
		// todo: error msg
        outputChannel.appendLine(`http code: ${resp.status}`);
    }
    const releases = resp.data;
	const latestRelease = releases.reduce((prev, curr) => {
		const version = curr.tag_name;
		if (curr.prerelease && !prev.prerelease) {
			return prev;
		}
		if (prev.prerelease && !curr.prerelease) {
			return curr;
		}
		const result = version.localeCompare(prev.tag_name, 'en-US', {numeric: true, sensitivity: 'base'});
		return result > 0 ? curr : prev;
	});
	return latestRelease.tag_name;
}

type ReleaseInfo = {
	tag_name: string;
	prerelease: boolean;
};
