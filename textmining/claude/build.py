"""classroom.src.html に解析エンジン（lens.css / lens.js）と共通マークアップを埋め込み、
claude.ai に公開する1ファイル版 classroom.html を作る。

使い方: python3 build.py [子どもに配るURL]
"""
import re
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parent
teacher = (root / 'teacher.html').read_text(encoding='utf-8')

def between(s, start, end):
    a = s.index(start)
    b = s.index(end, a)
    return s[a:b]

options = between(teacher, '<div class="two">', '\n          </div>\n        </details>')
results = between(teacher, '<section class="results"', '\n    </div>\n  </div>\n</div>') 

src = (here / 'classroom.src.html').read_text(encoding='utf-8')
out = (src
       .replace('/*LENS_CSS*/', (root / 'lens.css').read_text(encoding='utf-8'))
       .replace('/*LENS_JS*/', (root / 'lens.js').read_text(encoding='utf-8'))
       .replace('/*LENS_OPTIONS*/', options)
       .replace('/*LENS_RESULTS*/', results)
       .replace('/*STUDENT_URL*/', sys.argv[1] if len(sys.argv) > 1 else ''))
assert not re.search(r'/\*(LENS_\w+|STUDENT_URL)\*/', out)
(here / 'classroom.html').write_text(out, encoding='utf-8')
print('wrote', here / 'classroom.html', len(out), 'bytes')
