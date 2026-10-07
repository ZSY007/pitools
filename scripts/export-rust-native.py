"""Explicit build/CI artifact export. Never imported by the plugin runtime."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,tomllib
root=Path(__file__).resolve().parent.parent
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--allow-dirty',action='store_true');args=ap.parse_args()
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True))
if dirty and not args.allow_dirty:raise SystemExit('Refuse release export from a dirty source tree; --allow-dirty is local test only.')
compiler=subprocess.check_output(['rustc','-vV'],text=True);target=next(x.split(': ',1)[1]for x in compiler.splitlines()if x.startswith('host: '))
allowed={'x86_64-pc-windows-msvc','aarch64-apple-darwin','x86_64-apple-darwin','x86_64-unknown-linux-gnu'}
if target not in allowed:raise SystemExit('Unverified release target: '+target)
version=json.loads((root/'package.json').read_text())['version'];name='pitools-core.exe'if 'windows'in target else'pitools-core'
binary=root/'rust/pitools-core/target/release'/name
if not binary.is_file():raise SystemExit('Explicitly cargo build --release before export.')
out=Path(args.out).resolve()/target
if out.exists():raise SystemExit('Refuse overwriting a native artifact directory.')
lock=tomllib.loads((root/'rust/pitools-core/Cargo.lock').read_text());cargo=Path(os.environ.get('CARGO_HOME',str(Path.home()/'.cargo')))
licenses=[]
for pkg in lock['package']:
 if 'source'not in pkg:continue
 dirs=list((cargo/'registry/src').glob('*/'+pkg['name']+'-'+pkg['version']))
 if not dirs:raise SystemExit('Missing cached source/license: '+pkg['name'])
 source=dirs[0];files=sorted(p for p in source.glob('LICENSE*')if p.is_file())
 if not files:raise SystemExit('Missing LICENSE files: '+pkg['name'])
 licenses.extend((p,Path('licenses')/(pkg['name']+'-'+pkg['version'])/p.name)for p in files)
sysroot=Path(subprocess.check_output(['rustc','--print','sysroot'],text=True).strip())
stdlib=sysroot/'share/doc/rust/COPYRIGHT-library.html'
if not stdlib.is_file():raise SystemExit('Rust library copyright missing; explicitly add rust-docs in the build environment.')
licenses.append((stdlib,Path('licenses/rust-standard-library/COPYRIGHT-library.html')))
out.mkdir(parents=True);shutil.copy2(binary,out/name)
for source,rel in licenses:
 dst=out/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dst)
requirements={}
if target=='x86_64-unknown-linux-gnu':
 import re
 symbols=subprocess.check_output(['readelf','--version-info',str(binary)],text=True)
 versions={tuple(map(int,m.split('.')))for m in re.findall(r'GLIBC_([0-9]+(?:\.[0-9]+)+)',symbols)}
 if not versions:raise SystemExit('Cannot establish linked GNU libc requirement.')
 requirements['glibcMin']='.'.join(map(str,max(versions)))
info={'platformRequirements':requirements,'version':version,'target':target,'sourceCommit':commit,'sourceDirty':dirty,'rustc':compiler.splitlines()[0],'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'binaryBytes':binary.stat().st_size,'nodeUnicode':'16.0','licenses':{rel.as_posix():hashlib.sha256(src.read_bytes()).hexdigest()for src,rel in licenses}}
(out/'build-info.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf8')
print(json.dumps({'artifact':str(out),'target':target,'version':version,'dirtyLocalTest':dirty}))
