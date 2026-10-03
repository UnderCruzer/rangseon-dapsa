"""NOAA published approximate solar equations, not the full Meeus calculator.
Source https://gml.noaa.gov/grad/solcalc/solareqns.PDF
Apparent horizon: geometric solar-center altitude -0.833 degrees.
Local Asia/Tokyo day scanned at one-minute intervals. No building/hill obstruction.
"""
import math, calendar
from datetime import date, datetime, timedelta, timezone
METHOD_URL='https://gml.noaa.gov/grad/solcalc/solareqns.PDF'
JST=timezone(timedelta(hours=9))
def altitude(local, lat, lng):
    n=366 if calendar.isleap(local.year) else 365
    h=local.hour+local.minute/60+local.second/3600
    g=2*math.pi/n*(local.timetuple().tm_yday-1+(h-12)/24)
    eq=229.18*(.000075+.001868*math.cos(g)-.032077*math.sin(g)-.014615*math.cos(2*g)-.040849*math.sin(2*g))
    dec=.006918-.399912*math.cos(g)+.070257*math.sin(g)-.006758*math.cos(2*g)+.000907*math.sin(2*g)-.002697*math.cos(3*g)+.00148*math.sin(3*g)
    ha=math.radians(((h*60+eq+4*lng-540)%1440)/4-180)
    phi=math.radians(lat)
    return math.degrees(math.asin(math.sin(phi)*math.sin(dec)+math.cos(phi)*math.cos(dec)*math.cos(ha)))
def solar_day(day,lat,lng):
    meta={'method':'NOAA fractional-year approximation; 1-minute horizon scan', 'source_url':METHOD_URL,'horizon_deg':-.833,'timezone':'Asia/Tokyo','kind':'calculated','limitations':'Approximation, not observed time. Atmospheric/weather and local skyline effects unmodelled; minute precision is not a claimed accuracy.'}
    if day is None: return dict(meta,date=None,sunrise=None,sunset=None,status='미확인: 여행 날짜 필요')
    d=date.fromisoformat(day); start=datetime(d.year,d.month,d.day,tzinfo=JST)
    rise=setting=None; prev=altitude(start,lat,lng)
    for m in range(1,1441):
        at=start+timedelta(minutes=m); now=altitude(at,lat,lng)
        if prev<-.833<=now: rise=at.isoformat()
        if prev>=-.833>now: setting=at.isoformat()
        prev=now
    return dict(meta,date=day,sunrise=rise,sunset=setting,status='calculated')
