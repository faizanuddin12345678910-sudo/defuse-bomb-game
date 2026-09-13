// admin.js — upload an image to the repository using the GitHub Contents API
(async () => {
  const adminFile = document.getElementById('adminFile');
  const adminToken = document.getElementById('adminToken');
  const adminRepo = document.getElementById('adminRepo');
  const adminPath = document.getElementById('adminPath');
  const adminBranch = document.getElementById('adminBranch');
  const uploadBtn = document.getElementById('uploadBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const adminLog = document.getElementById('adminLog');

  function log(msg){ const t=new Date().toLocaleTimeString(); adminLog.insertAdjacentHTML('afterbegin','<div>['+t+'] '+msg+'</div>'); }

  async function readFileAsDataUrl(file){ return await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload = e=>res(e.target.result.split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); }); }

  async function getFileSha(owner, repo, path, branch, token){
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(url, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } });
    if(resp.status === 200){ const data = await resp.json(); return data.sha; }
    if(resp.status === 404) return null;
    throw new Error('Could not get file: ' + resp.status + ' ' + await resp.text());
  }

  async function uploadFileToRepo(owner, repo, path, branch, base64Content, token, sha=null){
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const body = { message: `Upload ${path} via admin UI`, content: base64Content, branch };
    if(sha) body.sha = sha;
    const resp = await fetch(url, { method: 'PUT', headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify(body) });
    return resp;
  }

  // helper to base64-encode a JSON-safe string (handles utf-8)
  function base64FromString(str){ return btoa(unescape(encodeURIComponent(str))); }

  uploadBtn.addEventListener('click', async ()=>{
    const file = adminFile.files && adminFile.files[0];
    const token = adminToken.value.trim();
    const repoVal = adminRepo.value.trim();
    const branch = adminBranch.value.trim() || 'gh-pages';
    let path = adminPath.value.trim() || 'assets/success.jpg';
    if(!file){ return alert('Choose an image file'); }
    if(!token){ return alert('Enter your GitHub Personal Access Token'); }
    if(!repoVal || repoVal.indexOf('/')===-1) return alert('Repository must be owner/repo');
    const [owner, repo] = repoVal.split('/');
    try{
      log('Reading file...');
      const base64 = await readFileAsDataUrl(file);
      // if admin path ends with a folder, append filename
      if(path.endsWith('/')) path = path + file.name;
      log('Checking for existing file on repo...');
      let sha = null;
      try{ sha = await getFileSha(owner, repo, path, branch, token); log(sha ? 'Existing file found (will update).' : 'No existing file (will create new).'); }catch(e){ log('Warning: could not check existing file: '+e.message); }
      log('Uploading image...');
      const resp = await uploadFileToRepo(owner, repo, path, branch, base64, token, sha);
      if(resp.ok){ const data = await resp.json(); log('Image upload successful: '+data.content.path);
        // create/update manifest assets/success.json pointing to this path
        const manifest = { path: data.content.path, updated: Date.now() };
        const manifestBase64 = base64FromString(JSON.stringify(manifest));
        const manifestPath = 'assets/success.json';
        let shaJson = null;
        try{ shaJson = await getFileSha(owner, repo, manifestPath, branch, token); }catch(e){ log('Could not check manifest existence: '+e.message); }
        log('Updating manifest '+manifestPath+' → '+manifest.path);
        const resp2 = await uploadFileToRepo(owner, repo, manifestPath, branch, manifestBase64, token, shaJson);
        if(resp2.ok){ log('Manifest updated. Players will see the new image soon.'); alert('Upload successful — manifest updated. Give Pages ~30-60s to serve the image.'); }
        else{ const t = await resp2.text(); log('Manifest update failed: '+resp2.status+' '+t); alert('Upload succeeded but manifest update failed: '+resp2.status); }
      }
      else{ const text = await resp.text(); log('Upload failed: '+resp.status+' '+text); alert('Upload failed: '+resp.status); }
    }catch(e){ log('Error: '+e.message); alert('Error: '+e.message); }
  });

  deleteBtn.addEventListener('click', async ()=>{
    const token = adminToken.value.trim();
    const repoVal = adminRepo.value.trim();
    const branch = adminBranch.value.trim() || 'gh-pages';
    const path = adminPath.value.trim() || 'assets/success.jpg';
    if(!token) return alert('Enter your GitHub token to delete');
    if(!repoVal || repoVal.indexOf('/')===-1) return alert('Repository must be owner/repo');
    const [owner, repo] = repoVal.split('/');
    if(!confirm('Delete '+path+' from '+repoVal+' on branch '+branch+'?')) return;
    try{
      log('Checking file SHA...');
      const sha = await getFileSha(owner, repo, path, branch, token);
      if(!sha){ log('File not found'); alert('File not found'); return; }
      log('Deleting file...');
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
      const body = { message: `Delete ${path} via admin UI`, branch, sha };
      const resp = await fetch(url, { method: 'DELETE', headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify(body) });
      if(resp.ok){ log('Deleted successfully');
        // also update or delete manifest
        const manifestPath = 'assets/success.json';
        const shaJson = await getFileSha(owner, repo, manifestPath, branch, token);
        if(shaJson){ // delete manifest too
          const url2 = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(manifestPath)}`;
          const body2 = { message: `Delete manifest via admin UI`, branch, sha: shaJson };
          const resp2 = await fetch(url2, { method: 'DELETE', headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify(body2) });
          if(resp2.ok) log('Manifest deleted'); else log('Manifest delete failed');
        }
        alert('Deleted. Manifest cleared.');
      } else { const text = await resp.text(); log('Delete failed: '+resp.status+' '+text); alert('Delete failed: '+resp.status); }
    }catch(e){ log('Error: '+e.message); alert('Error: '+e.message); }
  });
})();
