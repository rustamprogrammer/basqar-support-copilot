.PHONY: predict
predict:
	node scripts/predict.mjs --in "$(IN)" --out "$(OUT)"
