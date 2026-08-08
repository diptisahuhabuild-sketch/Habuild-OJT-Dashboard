#!/bin/bash
ids=(
"1m9cnG_wNubNG7sy2zaTtnpmIfy_7Wv26udBKgHFbPOE"
"1dWLPyDnXWW3YTnoyaztIh_89s1Jcdg_5j1hQEN85-pc"
"1QV7WcqR1utaZHN4QeFLza_bkglMmP-ZTyQQ55Z-CY4w"
"1n1dtuJpJGanvpgas0d9uoJLxA9_4DyBNr6DL_cRuMyM"
"1iVBQ7fG3IhVcNJew5VhxqdmgRTSrL_FmvIl1VulChqY"
"1bz5IC3feRcesHnDfcfdflatF8_j8XDs3sqdCNR2KnMs"
"1fvPUWGBMYkk2swjulkaUvYTvyolvfSSI-vJpjUIqu30"
"187hU2SndrjWjDpDmJWQTXsC7JSgxWbnqCl7nMWgJM-w"
"1dY6LMbwEOCE9MOIeH9Z_OpuCHJNOyf9JufN32cVJEbc"
"1FxNFq6zMx-BtVPuthjGEntc6qHPjmQeMeB1Vj4K18B0"
"1rSH29NlmlYZxNoOi9AtfCVzSh9E4LywZw7VeFe3kaHs"
"1mnQ2XVbLcRkga2JTyBOWzzGy1CIrWfk6aV1qaqloD_U"
"1Q9zJ_AzLTkNL4EB1zakdR6o5HopoXuSDW8gYgFQGHhA"
"1hEeplyrBy6wh8cqkr5w_r2Twz_0Vqtz4hZgXRV2V4ug"
"11DLvt-pt9ligWDE6mP6BdtT23XWuYJ2UYwiValnJIQw"
"1j2r2gU_L-2GIDm0zB_LfUbSS3e1i_frz3w-GzH4kzc4"
)

echo "Checking if IDs exist in server-config.json..."
for id in "${ids[@]}"; do
  if grep -q "$id" server-config.json; then
    echo "[FOUND] $id"
  else
    echo "[MISSING] $id"
  fi
done
