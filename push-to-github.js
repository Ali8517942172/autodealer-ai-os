const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const dir = process.cwd();
const repoUrl = 'https://github.com/Ali8517942172/nexus-os.git';

async function run() {
    try {
        const actualToken = process.env.GITHUB_PAT;
        if (!actualToken) throw new Error("GitHub PAT not found in process.env.GITHUB_PAT");

        console.log("Initializing git repo...");
        await git.init({ fs, dir });

        console.log("Adding remote...");
        try {
            await git.addRemote({
                fs, dir,
                remote: 'origin',
                url: repoUrl
            });
        } catch(e) {} // Ignore if already exists

        console.log("Staging all files...");
        const files = await git.statusMatrix({ fs, dir });
        for (const [filepath, , worktreeStatus, stageStatus] of files) {
            if (filepath === 'push-to-github.js') continue;
            // Ignore node_modules and .git
            if (filepath.includes('node_modules') || filepath.includes('.git')) continue;
            
            if (worktreeStatus !== stageStatus) {
                await git.add({ fs, dir, filepath });
            }
        }

        console.log("Committing files...");
        await git.commit({
            fs, dir,
            message: 'feat: add new Stitch screens and mock workflows for n8n, Zapier, Make',
            author: {
                name: 'NEXUS OS',
                email: 'deploy@Nexus.com'
            }
        });

        console.log("Pushing to GitHub...");
        const pushResult = await git.push({
            fs,
            http,
            dir,
            remote: 'origin',
            ref: 'main', // try main first
            onAuth: () => ({ username: actualToken, password: '' })
        }).catch(err => {
            console.log("Push to main failed, trying master...", err.message);
            return git.push({
                fs, http, dir, remote: 'origin', ref: 'master', onAuth: () => ({ username: actualToken, password: '' })
            });
        });
        
        console.log("Successfully pushed to GitHub!");
    } catch (err) {
        console.error("Error during push:", err);
    }
}

run();
