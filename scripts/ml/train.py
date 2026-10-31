"""Fit on train only; choose abstention thresholds on validation only. No runtime Python."""
import hashlib, json, sys
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from sklearn.feature_extraction import DictVectorizer
from sklearn.feature_extraction.text import TfidfTransformer
from sklearn.linear_model import LogisticRegression

source, destination = map(Path, sys.argv[1:3])
data = json.loads(source.read_text(encoding='utf-8'))
train = [r for r in data['rows'] if r['split'] == 'train']
valid = [r for r in data['rows'] if r['split'] == 'validation']
assert len(train) >= 20 and len(valid) >= 10, 'Need at least 20 training and 10 validation examples'
df = {}
for row in train:
    for feature in row['features']: df[feature] = df.get(feature, 0) + 1
features = set(f for f, n in sorted(df.items(), key=lambda p: (-p[1], p[0]))[:20000] if n >= 2)
vec = DictVectorizer()
x = vec.fit_transform([{f: n for f, n in r['features'].items() if f in features} for r in train])
tfidf = TfidfTransformer(sublinear_tf=True)
x = tfidf.fit_transform(x)
clf = LogisticRegression(C=4, max_iter=2000, class_weight='balanced', random_state=31)
clf.fit(x, [r['label'] for r in train])
assert len(clf.classes_) >= 3, 'Need at least three classes'
probs = clf.predict_proba(tfidf.transform(vec.transform([r['features'] for r in valid])))
thresholds, stats = {}, {}
for c, label in enumerate(clf.classes_):
    threshold = 1.1
    for candidate in [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]:
        selected = [i for i, p in enumerate(probs) if np.argmax(p) == c and p[c] >= candidate and p[c] - sorted(p)[-2] >= 0.2]
        correct = sum(valid[i]['label'] == label for i in selected)
        if len(selected) >= 5 and correct / len(selected) >= 0.9:
            threshold = candidate
            break
    selected = [i for i, p in enumerate(probs) if np.argmax(p) == c and p[c] >= threshold and p[c] - sorted(p)[-2] >= 0.2]
    correct = sum(valid[i]['label'] == label for i in selected)
    thresholds[label] = threshold
    stats[label] = dict(accepted=len(selected), correct=correct, precision=correct/len(selected) if selected else None)
provisional = sum(r['reviewStatus'] == 'provisional' for r in train + valid)
artifact = dict(version='intent-' + hashlib.sha256(source.read_bytes()).hexdigest()[:12],
    featureVersion=data['featureVersion'], provenance='provisional' if provisional else 'approved',
    trainedAt=datetime.now(timezone.utc).isoformat(), labels=clf.classes_.tolist(),
    vocabulary={k: int(v) for k,v in vec.vocabulary_.items()}, idf=np.round(tfidf.idf_, 8).tolist(),
    weights=np.round(clf.coef_, 8).tolist(), intercept=np.round(clf.intercept_, 8).tolist(),
    thresholds=thresholds, minMargin=0.2, minCoverage=0.35,
    training=dict(train=len(train), validation=len(valid), approved=len(train)+len(valid)-provisional, provisional=provisional, sha256=hashlib.sha256(source.read_bytes()).hexdigest()),
    validation=stats)
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(artifact, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
# Independent TS inference parity is checked before model activation.
parity = [dict(text=r['text'], understood=r['understood'], probabilities=p.tolist()) for r,p in zip(valid[:10],probs[:10])]
destination.with_suffix('.parity.json').write_text(json.dumps(parity,ensure_ascii=False),encoding='utf-8')
print(json.dumps(dict(version=artifact['version'], training=artifact['training'], thresholds=thresholds, validation=stats), ensure_ascii=False))
