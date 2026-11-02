"""Генерирует пак SFX под стиль Рыжикова (без внешних стоков, без прав третьих лиц).
Запуск: python3 montage/tools/make_sfx.py  -> montage/assets/sfx/*.wav
"""
import numpy as np, wave, pathlib
SR = 48000
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "sfx"

def save(name, x):
    x = np.asarray(x, dtype=np.float64)
    peak = np.max(np.abs(x)) or 1.0
    x = (x / peak * 0.89 * 32767).astype(np.int16)
    st = np.stack([x, x], axis=1)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())

def t(d): return np.arange(int(SR * d)) / SR
def env(n, a=0.002, r=0.1):
    tt = np.arange(n) / SR
    return np.minimum(1, tt / a) * np.exp(-tt / r)
rng = np.random.default_rng(7)

# уведомление (два тона, как мессенджер)
def ding(f, d=0.18):
    x = t(d); return np.sin(2*np.pi*f*x) * env(len(x), 0.003, 0.06) + 0.3*np.sin(2*np.pi*2*f*x)*env(len(x),0.003,0.03)
save("notification", np.concatenate([ding(1318), np.zeros(int(SR*0.04)), ding(1760, 0.3)]))
# пуш «+14 000 ₽» — монетка/кэш
x = t(0.5); coin = sum(np.sin(2*np.pi*f*x)*env(len(x),0.001,0.12)/i for i,f in enumerate([2093,2637,3136],1))
save("cash_push", np.concatenate([coin[:int(SR*0.08)], coin]))
# щелчок (счётчик / календарь / плашки на бит)
x = t(0.04); save("click", rng.normal(size=len(x)) * env(len(x), 0.0005, 0.004) + 0.5*np.sin(2*np.pi*3000*x)*env(len(x),0.0005,0.006))
# тик счётчика (тихий, для прокрутки цифр)
x = t(0.025); save("tick", np.sin(2*np.pi*4200*x) * env(len(x), 0.0003, 0.003))
# глухой удар (потери, «−90 000», кредитка на стол)
x = t(0.7); f = 110*np.exp(-x*6)+38
save("impact", np.sin(2*np.pi*np.cumsum(f)/SR) * env(len(x), 0.002, 0.22) + 0.25*rng.normal(size=len(x))*env(len(x),0.001,0.02))
# свуш (смена кадра / вылет плашки)
x = t(0.45); n = rng.normal(size=len(x)); 
from numpy.fft import rfft, irfft
spec = rfft(n); freqs = np.fft.rfftfreq(len(n), 1/SR); spec[(freqs<300)|(freqs>9000)] = 0
w = irfft(spec, len(n)) * np.sin(np.pi * x / x[-1])**2
save("whoosh", w)
# riser (нарастание к дропу «режим зверя»)
x = t(2.0); f = 200 + 1800*(x/x[-1])**2
save("riser", (np.sin(2*np.pi*np.cumsum(f)/SR)*0.4 + rng.normal(size=len(x))*0.3) * (x/x[-1])**2)
# скретч пластинки (спойлер про музыку)
x = t(0.6); ph = np.cumsum(600*np.sin(2*np.pi*3.3*x)+700)/SR
save("scratch", (np.sign(np.sin(2*np.pi*ph))*0.4 + rng.normal(size=len(x))*0.4) * np.sin(np.pi*x/x[-1]))
# бас-дроп
x = t(1.2); f = 70*np.exp(-x*2)+40
save("bass_drop", np.sin(2*np.pi*np.cumsum(f)/SR) * env(len(x), 0.005, 0.5))
# печатная машинка / набор даты «20.10.2025»
x = t(0.05); save("type_key", rng.normal(size=len(x))*env(len(x),0.0005,0.008) + 0.4*np.sin(2*np.pi*1800*x)*env(len(x),0.0005,0.01))
# «шлёп» купюры по столу
x = t(0.25); save("slap", rng.normal(size=len(x))*env(len(x),0.0005,0.03) + 0.6*np.sin(2*np.pi*180*x)*env(len(x),0.001,0.05))
print("ok:", sorted(p.name for p in OUT.glob("*.wav")))
