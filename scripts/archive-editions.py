"""Create reviewed distributable archives, not development backups."""
from pathlib import Path
import argparse,hashlib,json,tarfile
ap=argparse.ArgumentParser();ap.add_argument('--packages',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
root=Path(args.packages).resolve();out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True);sums=[]
for edition in ['ts','python','rust']:
 package=root/('pitools-'+edition);manifest=json.loads((package/'distribution.json').read_text());files=manifest['files'];actual={p.relative_to(package).as_posix()for p in package.rglob('*')if p.is_file()}
 if actual!=set(files)|{'distribution.json'}:raise SystemExit('Unexpected package files: '+edition)
 for file,digest in files.items():
  p=package/file
  if p.is_symlink()or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise SystemExit('Package digest mismatch: '+file)
 dest=out/(package.name+'-'+manifest['version']+'.tgz')
 if dest.exists():raise SystemExit('Refuse overwrite of release archive.')
 with tarfile.open(dest,'w:gz')as tf:
  for rel in sorted(actual):
   p=package/rel;info=tf.gettarinfo(str(p),arcname=package.name+'/'+rel);info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0
   info.mode=0o755 if rel.startswith('bin/')and p.name=='pitools-core'else 0o644
   with p.open('rb')as source:tf.addfile(info,source)
 sums.append(hashlib.sha256(dest.read_bytes()).hexdigest()+'  '+dest.name)
(out/'SHA256SUMS').write_text('\n'.join(sums)+'\n',encoding='ascii');print('\n'.join(sums))
