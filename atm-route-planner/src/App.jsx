import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Download, MapPinned, Route, Upload, Play, Trash2, Network } from "lucide-react";
import { saveAs } from "file-saver";

// ===== Config =====
// const API_BASE = "http://localhost:8000"; // FastAPI backend (OR-Tools)
const API_BASE = "http://127.0.0.1:8000"; // dùng backend local
const DEMO_MODE = false;
const DEPOT_ID = 1; // ATM trụ sở chính (bắt buộc start & end)
const DAILY_LIMIT = 50; // số ATM cần đi trong ngày (không tính DEPOT)

// ===== Helpers =====
function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseJSONL(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const ln of lines) {
    try {
      const obj = JSON.parse(ln);
      if (typeof obj.lat === "number" && typeof obj.lon === "number") rows.push(obj);
    } catch (e) { /* ignore */ }
  }
  return rows;
}

function toCSV(points, orderIds, allById) {
  const header = ["order","atm_id","raw_address","final_address","lat","lon","leg_m","cum_m"]; 
  let cum = 0;
  const rows = [];
  for (let i = 0; i < orderIds.length; i++) {
    const a = allById.get(orderIds[i]) || points.find(p=>p.atm_id===orderIds[i]);
    let leg = 0;
    if (i > 0) {
      const b = allById.get(orderIds[i-1]) || points.find(p=>p.atm_id===orderIds[i-1]);
      leg = Math.round(haversine(a, b));
    }
    cum += leg;
    rows.push([i + 1, a?.atm_id ?? "", a?.raw_address ?? "", a?.final_address ?? "", a?.lat, a?.lon, leg, cum]);
  }
  const csv = [header.join(",")].concat(rows.map(r => r.map(x => typeof x === "string" ? `"${x.replaceAll('"','""')}"` : x).join(","))).join("\n");
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

// ===== Demo data (có thể dán/nhập file) =====
const demoJSONL = `{"lat": 20.9971172, "lon": 105.8422354, "final_address": "1E TRUONG CHINH, Hà Nội, Việt Nam", "display": "Bệnh viện An Việt, 1E, Đường Trường Chinh, Phường Tương Mai, Thành phố Hà Nội, 10999, Việt Nam", "raw_address": "1E TRUONG CHINH", "route": "Tuyến 1", "atm_id": 99098014}
{"lat": 21.0022278, "lon": 105.8313173, "final_address": "1 TON THAT TUNG, Hà Nội, Việt Nam", "display": "Trường Đại học Y Hà Nội, 1, Phố Tôn Thất Tùng, Khu tập thể Khương Thượng, Phường Kim Liên, Thành phố Hà Nội, 11415, Việt Nam", "raw_address": "1 TON THAT TUNG", "route": "Tuyến 1", "atm_id": 99098015}
{"lat": 21.002167, "lon": 105.8154867, "final_address": "ROYAL CITY, Hà Nội, Việt Nam", "display": "Vinhomes Royal City, Phường Thanh Xuân, Thành phố Hà Nội, Việt Nam", "raw_address": "R5L1 ROYAL CITY", "route": "Tuyến 1", "atm_id": 99098021}
{"lat": 21.0107986, "lon": 105.8458009, "final_address": "29 Nguyễn Đình Chiểu, P Hai Bà Trưng, Hà Nội, Việt Nam", "display": "Phố Nguyễn Đình Chiểu, Phường Hai Bà Trưng, Thành phố Hà Nội, 10058, Việt Nam", "raw_address": "29 Nguyễn Đình Chiểu, P Hai Bà Trưng, HN", "route": "Tuyến 1", "atm_id": 99098022}
{"lat": 20.9959723, "lon": 105.8667531, "final_address": "VINMEC 458 MINH KHAI, Hà Nội, Việt Nam", "display": "Bệnh viện Đa khoa Quốc tế Vinmec Times City, 458, Phố Minh Khai, Phường Vĩnh Tuy, Thành phố Hà Nội, 11622, Việt Nam", "raw_address": "VINMEC 458 MINH KHAI", "route": "Tuyến 1", "atm_id": 99098025}
{"lat": 21.0035231, "lon": 105.8534546, "final_address": "43B THANH NHAN, Hà Nội, Việt Nam", "display": "Ngõ 88 Phố Thanh Nhàn, Phường Bạch Mai, Thành phố Hà Nội, 10053, Việt Nam", "raw_address": "43B THANH NHAN", "route": "Tuyến 1", "atm_id": 99098031}
{"lat": 21.0015788, "lon": 105.8449658, "final_address": "1 Trần Đại Nghĩa, Hà Nội, Việt Nam", "display": "Phòng giao dịch ngân hàng TMCP ngoại thương Việt Nam, 1, Phố Trần Đại Nghĩa, Phường Bạch Mai, Thành phố Hà Nội, 10999, Việt Nam", "raw_address": "ĐHBK 1 Trần Đại Nghĩa, P Tương Mai, HN", "route": "Tuyến 1", "atm_id": 99098032}
{"lat": 20.9543626, "lon": 105.8412028, "final_address": "184 Tựu Liệt, Hà Nội, Việt Nam", "display": "Tựu Liệt, Phường Hoàng Liệt, Văn Điển, Thành phố Hà Nội, 12506, Việt Nam", "raw_address": "184 Tựu Liệt, X Thanh Trì, HN", "route": "Tuyến 1", "atm_id": 99098033}
{"lat": 21.0121836, "lon": 105.8480469, "final_address": "52 LE DAI HANH, Hà Nội, Việt Nam", "display": "Toà nhà Gelex, 52, Phố Lê Đại Hành, Phường Hai Bà Trưng, Thành phố Hà Nội, 10058, Việt Nam", "raw_address": "52 LE DAI HANH", "route": "Tuyến 1", "atm_id": 99098035}
{"lat": 21.0080135, "lon": 105.8204891, "final_address": "49 THAI THINH, Hà Nội, Việt Nam", "display": "Phố Thái Thịnh, Phường Đống Đa, Thành phố Hà Nội, 10167, Việt Nam", "raw_address": "49 THAI THINH", "route": "Tuyến 1", "atm_id": 99098036}
{"lat": 21.0084671, "lon": 105.8344507, "final_address": "B14 KIM LIEN , HA NOI, Hà Nội, Việt Nam", "display": "B14, Ngõ 65 Phạm Ngọc Thạch, Khu chung cư Kim Liên, Phường Kim Liên, Thành phố Hà Nội, 11415, Việt Nam", "raw_address": "B14 KIM LIEN , HA NOI", "route": "Tuyến 1", "atm_id": 99098039}
{"lat": 21.0040944, "lon": 105.8479086, "final_address": "BACH KHOA - 17 TA QUANG BUU, Hà Nội, Việt Nam", "display": "Nhà khách Bách Khoa, 1, Ngõ 17 Phố Tạ Quang Bửu, Phường Bạch Mai, Thành phố Hà Nội, 10999, Việt Nam", "raw_address": "PGD BACH KHOA - 17 TA QUANG BUU", "route": "Tuyến 1", "atm_id": 99098046}
{"lat": 20.9369206, "lon": 105.8482764, "final_address": "2 DUONG QUANG LAI, XA NGU HIEP, THANH TRI, HA NOI, Hà Nội, Việt Nam", "display": "Đường Quang Lai, Cương Ngô, Xã Thanh Trì, Thành phố Hà Nội, 12506, Việt Nam", "raw_address": "2 DUONG QUANG LAI, XA NGU HIEP, THANH TRI, HA NOI", "route": "Tuyến 1", "atm_id": 99098050}
{"lat": 21.0085342, "lon": 105.8376351, "final_address": "9 Đào Duy Anh, P Kim Liên, Hà Nội, Việt Nam", "display": "Tòa nhà VCCI, 9, Phố Đào Duy Anh, Phường Kim Liên, Thành phố Hà Nội, 10306, Việt Nam", "raw_address": "9 Đào Duy Anh, P Kim Liên, HN", "route": "Tuyến 1", "atm_id": 99098074}
{"lat": 21.0085342, "lon": 105.8376351, "final_address": "9 Đào Duy Anh, P Kim Liên, Hà Nội, Việt Nam", "display": "Tòa nhà VCCI, 9, Phố Đào Duy Anh, Phường Kim Liên, Thành phố Hà Nội, 10306, Việt Nam", "raw_address": "9 Đào Duy Anh, P Kim Liên, HN", "route": "Tuyến 1", "atm_id": 99098075}
{"lat": 20.9921746, "lon": 105.8623879, "final_address": "18 Tam Trinh, Hà Nội, Việt Nam", "display": "18 Tam Trinh, Đường Tam Trinh, Phường Tương Mai, Thành phố Hà Nội, 11617, Việt Nam", "raw_address": "18 Tam Trinh, P Bạch Mai, HN", "route": "Tuyến 1", "atm_id": 99098076}
{"lat": 20.9921746, "lon": 105.8623879, "final_address": "18 Tam Trinh, Hà Nội, Việt Nam", "display": "18 Tam Trinh, Đường Tam Trinh, Phường Tương Mai, Thành phố Hà Nội, 11617, Việt Nam", "raw_address": "18 Tam Trinh, P Bạch Mai, HN", "route": "Tuyến 1", "atm_id": 99098077}
{"lat": 21.0248055, "lon": 105.8516747, "final_address": "19 BA TRIEU, Hà Nội, Việt Nam", "display": "Toà nhà Naforimex, 19, Phố Bà Triệu, Phường Cửa Nam, Thành phố Hà Nội, 10211, Việt Nam", "raw_address": "19 BA TRIEU", "route": "Tuyến 1", "atm_id": 99098080}
{"lat": 20.9998438, "lon": 105.8283776, "final_address": "3 LE TRONG TAN, THANH XUAN, HA NOI, Hà Nội, Việt Nam", "display": "Trung tâm thương mại Artemis, 3, Phố Lê Trọng Tấn, Phường Phương Liệt, Thành phố Hà Nội, 11415, Việt Nam", "raw_address": "3 LE TRONG TAN, THANH XUAN, HA NOI", "route": "Tuyến 1", "atm_id": 99098086}
{"lat": 21.0056507, "lon": 105.8689018, "final_address": "124 MINH KHAI, Hà Nội, Việt Nam", "display": "Minh Khai, Phường Vĩnh Tuy, Thành phố Hà Nội, 11622, Việt Nam", "raw_address": "124 MINH KHAI", "route": "Tuyến 1", "atm_id": 99098090}
{"lat": 21.0015788, "lon": 105.8449658, "final_address": "1 Trần Đại Nghĩa, Hà Nội, Việt Nam", "display": "Phòng giao dịch ngân hàng TMCP ngoại thương Việt Nam, 1, Phố Trần Đại Nghĩa, Phường Bạch Mai, Thành phố Hà Nội, 10999, Việt Nam", "raw_address": "ĐHBK 1 Trần Đại Nghĩa, P Tương Mai, HN", "route": "Tuyến 1", "atm_id": 99098102}
{"lat": 21.0062588, "lon": 105.8419767, "final_address": "185 Trần Đại Nghĩa, Hà Nội, Việt Nam", "display": "Quảng trường Trần Đại Nghĩa, Phường Bạch Mai, Thành phố Hà Nội, Việt Nam", "raw_address": "ĐHKT 185 Trần Đại Nghĩa, P Tương Mai, HN", "route": "Tuyến 1", "atm_id": 99098110}
{"lat": 21.0235193, "lon": 105.8474812, "final_address": "74 THO NHUOM, Hà Nội, Việt Nam", "display": "BIDV, 74, Phố Thợ Nhuộm, Phường Cửa Nam, Thành phố Hà Nội, 10307, Việt Nam", "raw_address": "74 THO NHUOM", "route": "Tuyến 1", "atm_id": 99098137}
{"lat": 21.0202274, "lon": 105.8583536, "final_address": "4B LE THANH TONG, Hà Nội, Việt Nam", "display": "Phố Lê Thánh Tông, Phường Cửa Nam, Thành phố Hà Nội, 10151, Việt Nam", "raw_address": "4B LE THANH TONG", "route": "Tuyến 1", "atm_id": 99098143}
{"lat": 21.0235193, "lon": 105.8474812, "final_address": "THO NHUOM, Hà Nội, Việt Nam", "display": "BIDV, 74, Phố Thợ Nhuộm, Phường Cửa Nam, Thành phố Hà Nội, 10307, Việt Nam", "raw_address": "TSCN 74 THO NHUOM", "route": "Tuyến 1", "atm_id": 99098147}
{"lat": 21.0190265, "lon": 105.8090244, "final_address": "57 Láng Hạ, Hà Nội, Việt Nam", "display": "VNPT Tower, 57, Phố Huỳnh Thúc Kháng, Phường Láng, Thành phố Hà Nội, 11513, Việt Nam", "raw_address": "TRU SO CHI NHANH 57 LANG HA", "route": "Tuyến 1", "atm_id": 99098199}
{"lat": 20.9576026, "lon": 105.8138808, "final_address": "350 PHAN TRONG TUE, Hà Nội, Việt Nam", "display": "Ngách 250/60 Phan Trọng Tuệ, Phường Thanh Liệt, Thành phố Hà Nội, 10135, Việt Nam", "raw_address": "350 PHAN TRONG TUE", "route": "Tuyến 1", "atm_id": 99098222}
{"lat": 20.9706579, "lon": 105.8417882, "final_address": "1281 GIAI PHONG, Hà Nội, Việt Nam", "display": "BIDV, 1281, GIải Phóng, Phường Định Công, Văn Điển, Thành phố Hà Nội, 12506, Việt Nam", "raw_address": "1281 GIAI PHONG", "route": "Tuyến 1", "atm_id": 99098234}
{"lat": 20.9706579, "lon": 105.8417882, "final_address": "1281 GIAI PHONG, Hà Nội, Việt Nam", "display": "BIDV, 1281, GIải Phóng, Phường Định Công, Văn Điển, Thành phố Hà Nội, 12506, Việt Nam", "raw_address": "1281 GIAI PHONG", "route": "Tuyến 1", "atm_id": 99098235}
{"lat": 20.9204562, "lon": 105.8322555, "final_address": "NGO 405 NGOC HOI, Hà Nội, Việt Nam", "display": "Ngõ 10 Xóm Hưng Đạo, Vĩnh Thịnh, Xã Ngọc Hồi, Thành phố Hà Nội, 12506, Việt Nam", "raw_address": "NGO 405 NGOC HOI", "route": "Tuyến 1", "atm_id": 99098236}
{"lat": 20.9233689, "lon": 105.8426967, "final_address": "405 ngoc hoi, ha noi, viet nam", "display": "Ngọc Hồi, Thành phố Hà Nội, 12506, Việt Nam", "raw_address": "405 ngoc hoi, ha noi, viet nam", "route": "Tuyến 1", "atm_id": 99098237}
{"lat": 20.9637289, "lon": 105.8289548, "final_address": "cong vien ban dao linh dam, hoang liet", "display": "Công viên Bán đảo Linh Đàm, Phường Hoàng Liệt, Văn Điển, Thành phố Hà Nội, Việt Nam", "raw_address": "cong vien ban dao linh dam, hoang liet", "route": "Tuyến 1", "atm_id": 99098238}
{"lat": 21.0039149, "lon": 105.8313598, "final_address": "SO 02 TON THAT TUNG, Hà Nội, Việt Nam", "display": "Ngõ 1A Phố Tôn Thất Tùng, Khu tập thể Khương Thượng, Phường Kim Liên, Thành phố Hà Nội, 11415, Việt Nam", "raw_address": "CRM - SO 02 TON THAT TUNG", "route": "Tuyến 1", "atm_id": 99099603}
{"lat": 20.9705159, "lon": 105.8277396, "final_address": "40-41 BAC LINH DAM, Hà Nội, Việt Nam", "display": "Bắc Linh Đàm, Linh Đàm, Phường Định Công, Văn Điển, Thành phố Hà Nội, 11718, Việt Nam", "raw_address": "CRM - LOBT1 40_41 BAC LINH DAM", "route": "Tuyến 1", "atm_id": 99099605}
{"lat": 20.9939061, "lon": 105.8680484, "final_address": "Times City, Hà Nội, Việt Nam", "display": "Vinhomes Times City, 458, Phường Vĩnh Tuy, Thành phố Hà Nội, 100000, Việt Nam", "raw_address": "T10 Times City, Minh Khai, HBT, HN", "route": "Tuyến 1", "atm_id": 99099614}
{"lat": 21.0068485, "lon": 105.8600861, "final_address": "255-257 KIM NGUU, Hà Nội, Việt Nam", "display": "Ngõ 84 Kim Ngưu, Phường Bạch Mai, Thành phố Hà Nội, 10078, Việt Nam", "raw_address": "255-257 KIM NGUU", "route": "Tuyến 1", "atm_id": 99099648}
{"lat": 21.0179645, "lon": 105.8113925, "final_address": "27 Huỳnh Thúc Kháng, P Láng, Hà Nội, Việt Nam", "display": "Tòa nhà UDIC, 27, Phố Huỳnh Thúc Kháng, Phường Láng, Thành phố Hà Nội, 11513, Việt Nam", "raw_address": "27 Huỳnh Thúc Kháng, P Láng, HN", "route": "Tuyến 2", "atm_id": 99098009}
{"lat": 21.0296726, "lon": 105.8423529, "final_address": "14 Điện Biên Phủ, P Ba Đình, Hà Nội, Việt Nam", "display": "14, Đường Điện Biên Phủ, Phường Ba Đình, Thành phố Hà Nội, 11060, Việt Nam", "raw_address": "14 Điện Biên Phủ, P Ba Đình, HN", "route": "Tuyến 2", "atm_id": 99098020}
{"lat": 21.019212, "lon": 105.8293186, "final_address": "ocd plaza, 29 duong la thanh, ha noi, vietnam", "display": "OCD Plaza, 29, Đường La Thành, Phường Ô Chợ Dừa, Thành phố Hà Nội, 10306, Việt Nam", "raw_address": "ocd plaza, 29 duong la thanh, ha noi, vietnam", "route": "Tuyến 2", "atm_id": 99098030}
{"lat": 21.020364, "lon": 105.8292315, "final_address": "278 TON DUC THANG, HA NOI, Hà Nội, Việt Nam", "display": "Tổng Công ty Tư vấn Thiết kế Giao thông Vận tải, 278, Phố Tôn Đức Thắng, Phường Ô Chợ Dừa, Thành phố Hà Nội, 10306, Việt Nam", "raw_address": "278 TON DUC THANG, HA NOI", "route": "Tuyến 2", "atm_id": 99098044}
{"lat": 21.0212913, "lon": 105.8242729, "final_address": "418 Đê La Thành, Ô Chợ Dừa, Ha Noi", "display": "Ngõ 217 Đê La Thành, Phường Ô Chợ Dừa, Thành phố Hà Nội, 10178, Việt Nam", "raw_address": "418 Đê La Thành, Ô Chợ Dừa, Ha Noi", "route": "Tuyến 2", "atm_id": 99098049}
{"lat": 21.0275039, "lon": 105.8474388, "final_address": "14 phu doan, ha noi", "display": "BIDV, 14, Phố Phủ Doãn, Phường Hoàn Kiếm, Thành phố Hà Nội, 10041, Việt Nam", "raw_address": "14 phu doan, ha noi", "route": "Tuyến 2", "atm_id": 99098082}
{"lat": 21.0283693, "lon": 105.8469973, "final_address": "BENH VIEN VIET DUC, Hà Nội, Việt Nam", "display": "Bệnh viện Hữu nghị Việt Đức, 40, Phố Phủ Doãn, Phường Hoàn Kiếm, Thành phố Hà Nội, 11015, Việt Nam", "raw_address": "BENH VIEN VIET DUC", "route": "Tuyến 2", "atm_id": 99098083}
{"lat": 21.0258371, "lon": 105.822025, "final_address": "D2 Giảng Võ, P Giảng Võ, Hà Nội, Việt Nam", "display": "Loyal Poker Club, D2, Phố Giảng Võ, Phường Giảng Võ, Thành phố Hà Nội, 10178, Việt Nam", "raw_address": "D2 Giảng Võ, P Giảng Võ, HN", "route": "Tuyến 2", "atm_id": 99098084}
{"lat": 21.0301831, "lon": 105.8563219, "final_address": "38 HANG VOI, Hà Nội, Việt Nam", "display": "BIDV, 38-40, Phố Hàng Vôi, Phường Hoàn Kiếm, Thành phố Hà Nội, 11007, Việt Nam", "raw_address": "38 HANG VOI", "route": "Tuyến 2", "atm_id": 99098092}
{"lat": 21.03532, "lon": 105.8141712, "final_address": "26 Liễu Giai, P Ngọc Hà, Hà Nội, Việt Nam", "display": "L's Place, 26, Phố Liễu Giai, Phường Ngọc Hà, Thành phố Hà Nội, 10071, Việt Nam", "raw_address": "26 Liễu Giai, P Ngọc Hà, HN", "route": "Tuyến 2", "atm_id": 99098095}
{"lat": 21.0286188, "lon": 105.8506851, "final_address": "126 HANG TRONG, Hà Nội, Việt Nam", "display": "HĐND phường Hoàn Kiếm, 126, Phố Hàng Trống, Phường Hoàn Kiếm, Thành phố Hà Nội, 10016, Việt Nam", "raw_address": "126 HANG TRONG", "route": "Tuyến 2", "atm_id": 99098107}
{"lat": 21.03532, "lon": 105.8141712, "final_address": "26 LIEU GIAI, Hà Nội, Việt Nam", "display": "L's Place, 26, Phố Liễu Giai, Phường Ngọc Hà, Thành phố Hà Nội, 10071, Việt Nam", "raw_address": "26 LIEU GIAI", "route": "Tuyến 2", "atm_id": 99098114}
{"lat": 21.0280105, "lon": 105.824828, "final_address": "138 GIANG VO, Hà Nội, Việt Nam", "display": "138, Phố Giảng Võ, Phường Giảng Võ, Thành phố Hà Nội, 10060, Việt Nam", "raw_address": "138 GIANG VO", "route": "Tuyến 2", "atm_id": 99098120}
{"lat": 21.019472, "lon": 105.8165582, "final_address": "14 Láng Hạ,  P Giảng Võ, Hà Nội, Việt Nam", "display": "14, Phố Láng Hạ, Phường Giảng Võ, Thành phố Hà Nội, 10265, Việt Nam", "raw_address": "14 Láng Hạ,  P Giảng Võ, HN", "route": "Tuyến 2", "atm_id": 99098133}
{"lat": 21.019472, "lon": 105.8165582, "final_address": "14 Láng Hạ,  P Giảng Võ, Hà Nội, Việt Nam", "display": "14, Phố Láng Hạ, Phường Giảng Võ, Thành phố Hà Nội, 10265, Việt Nam", "raw_address": "14 Láng Hạ,  P Giảng Võ, HN", "route": "Tuyến 2", "atm_id": 99098134}
{"lat": 21.033057, "lon": 105.8524553, "final_address": "42-44 GIA NGU, Hà Nội, Việt Nam", "display": "Phố Gia Ngư, Khu phố cổ, Phường Hoàn Kiếm, Thành phố Hà Nội, 11011, Việt Nam", "raw_address": "42-44 GIA NGU", "route": "Tuyến 2", "atm_id": 99098138}
{"lat": 21.0111892, "lon": 105.8494705, "final_address": "191 Bà Triệu, P. Hai Bà Trưng, Hà Nội, Việt Nam", "display": "Vincom Center Bà Triệu, 191, Phố Bà Triệu, Phường Hai Bà Trưng, Thành phố Hà Nội, 10058, Việt Nam", "raw_address": "191 Bà Triệu, P. Hai Bà Trưng, HN", "route": "Tuyến 2", "atm_id": 99098140}
{"lat": 21.0111892, "lon": 105.8494705, "final_address": "191 Bà Triệu, P. Hai Bà Trưng, Hà Nội, Việt Nam", "display": "Vincom Center Bà Triệu, 191, Phố Bà Triệu, Phường Hai Bà Trưng, Thành phố Hà Nội, 10058, Việt Nam", "raw_address": "191 Bà Triệu, P. Hai Bà Trưng, HN", "route": "Tuyến 2", "atm_id": 99098141}
{"lat": 21.0413378, "lon": 105.8381163, "final_address": "39C Phan Đình Phùng, P Ba Đình, Hà Nội, Việt Nam", "display": "Phố Phan Đình Phùng, Phường Ba Đình, Thành phố Hà Nội, 10086, Việt Nam", "raw_address": "39C Phan Đình Phùng, P Ba Đình, HN", "route": "Tuyến 2", "atm_id": 99098146}
{"lat": 21.0357738, "lon": 105.8483192, "final_address": "96 Thuốc Bắc, P Hoàn Kiếm, Hà Nội, Việt Nam", "display": "Phố Thuốc Bắc, Khu phố cổ, Phường Hoàn Kiếm, Thành phố Hà Nội, 11058, Việt Nam", "raw_address": "96 Thuốc Bắc, P Hoàn Kiếm, HN", "route": "Tuyến 2", "atm_id": 99098148}
{"lat": 21.0405555, "lon": 105.8410322, "final_address": "CUA BAC, Hà Nội, Việt Nam", "display": "Cửa Bắc, Phố Phan Đình Phùng, Phường Ba Đình, Thành phố Hà Nội, 10075, Việt Nam", "raw_address": "TSCN 11 CUA BAC", "route": "Tuyến 2", "atm_id": 99098153}
{"lat": 21.0338731, "lon": 105.8527192, "final_address": "125-127 HANG BAC, Hà Nội, Việt Nam", "display": "Phố Hàng Bạc, Khu phố cổ, Phường Hoàn Kiếm, Thành phố Hà Nội, 11011, Việt Nam", "raw_address": "125-127 HANG BAC", "route": "Tuyến 2", "atm_id": 99098163}
{"lat": 21.0324537, "lon": 105.8478739, "final_address": "26 Hàng nón, P Hoàn Kiếm, Hà Nội, Việt Nam", "display": "Phố Hàng Nón, Khu phố cổ, Phường Hoàn Kiếm, Thành phố Hà Nội, 11015, Việt Nam", "raw_address": "26 Hàng nón, P Hoàn Kiếm, HN", "route": "Tuyến 2", "atm_id": 99098203}
{"lat": 21.04209, "lon": 105.8176278, "final_address": "463 HOANG HOA THAM, Hà Nội, Việt Nam", "display": "Hoàng Hoa Thám, Phường Ngọc Hà, Thành phố Hà Nội, 10071, Việt Nam", "raw_address": "463 HOANG HOA THAM", "route": "Tuyến 2", "atm_id": 99098205}
{"lat": 21.0639841, "lon": 105.8277707, "final_address": "51 XUAN DIEU, Hà Nội, Việt Nam", "display": "Khách sạn Fraser Suites Hà Nội, 51, Đường Xuân Diệu, Phường Tây Hồ, Thành phố Hà Nội, 11207, Việt Nam", "raw_address": "51 XUAN DIEU", "route": "Tuyến 2", "atm_id": 99098207}
{"lat": 21.0290414, "lon": 105.8500781, "final_address": "25 nha tho street, ha noi", "display": "Phố Nhà Thờ, Phường Hoàn Kiếm, Thành phố Hà Nội, 10016, Việt Nam", "raw_address": "25 nha tho street, ha noi", "route": "Tuyến 2", "atm_id": 99098208}
{"lat": 21.0345574, "lon": 105.8535202, "final_address": "73 Ma May, Hà Nội, Việt Nam", "display": "Khách Sạn Và Spa Matilda Boutique, 73, Phố Mã Mây, Khu phố cổ, Phường Hoàn Kiếm, Thành phố Hà Nội, 11010, Việt Nam", "raw_address": "73 Ma May", "route": "Tuyến 2", "atm_id": 99098209}
{"lat": 21.0520947, "lon": 105.8366952, "final_address": "76 YEN PHU, Hà Nội, Việt Nam", "display": "The Hanoi Club Hotel & Residences, 76, Phố Yên Phụ, Phường Tây Hồ, Thành phố Hà Nội, 10266, Việt Nam", "raw_address": "76 YEN PHU", "route": "Tuyến 2", "atm_id": 99098210}
{"lat": 21.0258371, "lon": 105.822025, "final_address": "D2 Giảng Võ, P Giảng Võ, Hà Nội, Việt Nam", "display": "Loyal Poker Club, D2, Phố Giảng Võ, Phường Giảng Võ, Thành phố Hà Nội, 10178, Việt Nam", "raw_address": "D2 Giảng Võ, P Giảng Võ, HN", "route": "Tuyến 2", "atm_id": 99098211}
{"lat": 21.0186359, "lon": 105.8487059, "final_address": "49 Hai Bà Trưng, P Cửa Nam, Hà Nội, Việt Nam", "display": "Trung tâm Văn hóa Hàn Quốc, 49, Phố Nguyễn Du, Phường Cửa Nam, Thành phố Hà Nội, 10292, Việt Nam", "raw_address": "49 Hai Bà Trưng, P Cửa Nam, HN", "route": "Tuyến 2", "atm_id": 99098226}
{"lat": 21.0293886, "lon": 105.8114728, "final_address": "521 KIM MÃ, Hà Nội, Việt Nam", "display": "HANDIRESCO Tower, 521, Phố Kim Mã, Phường Giảng Võ, Thành phố Hà Nội, 10252, Việt Nam", "raw_address": "521 KIM MÃ", "route": "Tuyến 2", "atm_id": 99098232}
{"lat": 21.0299524, "lon": 105.8466987, "final_address": "95 Hàng bông, P Hoàn Kiếm, Hà Nội, Việt Nam", "display": "Royal Palace Hotel, 95, Phố Hàng Bông, Khu phố cổ, Phường Hoàn Kiếm, Thành phố Hà Nội, 11017, Việt Nam", "raw_address": "95 Hàng bông, P Hoàn Kiếm, Hà Nội", "route": "Tuyến 2", "atm_id": 99098303}
{"lat": 21.0315201, "lon": 105.8504742, "final_address": "44 Hàng Hành, P Hoàn Kiếm, Hà Nội, Việt Nam", "display": "Phố Hàng Hành, Phường Hoàn Kiếm, Thành phố Hà Nội, 11057, Việt Nam", "raw_address": "44 Hàng Hành, P Hoàn Kiếm, HN", "route": "Tuyến 2", "atm_id": 99098304}
{"lat": 21.0111892, "lon": 105.8494705, "final_address": "191 Bà Triệu, P. Hai Bà Trưng, Hà Nội, Việt Nam", "display": "Vincom Center Bà Triệu, 191, Phố Bà Triệu, Phường Hai Bà Trưng, Thành phố Hà Nội, 10058, Việt Nam", "raw_address": "191 Bà Triệu, P. Hai Bà Trưng, HN", "route": "Tuyến 2", "atm_id": 99099604}
{"lat": 21.0191176, "lon": 105.8173515, "final_address": "57 LANG HA, Hà Nội, Việt Nam", "display": "Tòa nhà Thành Công, 57, Phố Láng Hạ, Phường Ô Chợ Dừa, Thành phố Hà Nội, 10265, Việt Nam", "raw_address": "57 LANG HA, P. THANH CONG, Q. BA DINH, HA NOI", "route": "Tuyến 2", "atm_id": 99099613}
{"lat": 21.0245934, "lon": 105.8524038, "final_address": "HAI BA TRUNG HOAN KIEM, Hà Nội, Việt Nam", "display": "BIDV, 34, Phố Hai Bà Trưng, Phường Cửa Nam, Thành phố Hà Nội, 10296, Việt Nam", "raw_address": "CRM - 41 HAI BA TRUNG HOAN KIEM", "route": "Tuyến 2", "atm_id": 99099621}
{"lat": 21.0190265, "lon": 105.8090244, "final_address": "57 HUYNH THUC KHANG, DONG DA, HA NOI, Hà Nội, Việt Nam", "display": "VNPT Tower, 57, Phố Huỳnh Thúc Kháng, Phường Láng, Thành phố Hà Nội, 11513, Việt Nam", "raw_address": "57 HUYNH THUC KHANG, DONG DA, HA NOI", "route": "Tuyến 2", "atm_id": 99099647}
{"lat": 21.0142142, "lon": 105.813942, "final_address": "99 LANG HA, Hà Nội, Việt Nam", "display": "Chung cư Petrowaco Tower, 97-99, Phố Láng Hạ, Phường Đống Đa, Thành phố Hà Nội, 10167, Việt Nam", "raw_address": "99 LANG HA", "route": "Tuyến 2", "atm_id": 99099650}
{"lat": 21.0294534, "lon": 105.857076, "final_address": "194 Trần Quang Khải, P Hoàn Kiếm, Hà Nội, Việt Nam", "display": "BIDV Tower, 194, Đường Trần Quang Khải, Phường Hoàn Kiếm, Thành phố Hà Nội, 10262, Việt Nam", "raw_address": "194 Trần Quang Khải, P Hoàn Kiếm, HN", "route": "Tuyến 3", "atm_id": 99098003}
{"lat": 21.0294534, "lon": 105.857076, "final_address": "194 Trần Quang Khải, P. Hoàn Kiếm, Hà Nội, Việt Nam", "display": "BIDV Tower, 194, Đường Trần Quang Khải, Phường Hoàn Kiếm, Thành phố Hà Nội, 10262, Việt Nam", "raw_address": "194 Trần Quang Khải, P. Hoàn Kiếm, HN", "route": "Tuyến 3", "atm_id": 99098004}
{"lat": 21.0790467, "lon": 105.8746919, "final_address": "Khu đô thị Eurowindow River Park, Lại Đà, Xã Đông Anh, Hà Nội, Việt Nam", "display": "Khu đô thị Eurowindow River Park, Lại Đà, Xã Đông Anh, Thành phố Hà Nội, Việt Nam", "raw_address": "Khu đô thị Eurowindow River Park, Lại Đà, Xã Đông Anh, Hà Nội, Việt Nam", "route": "Tuyến 3", "atm_id": 99098005}
{"lat": 21.1199756, "lon": 105.8733527, "final_address": "UBND Co Loa, Dong Anh, Ha Noi, Việt Nam", "display": "UBND xã Cổ Loa, Đường Cổ Loa, Xã Đông Anh, Thành phố Hà Nội, 12323, Việt Nam", "raw_address": "UBND Co Loa, Dong Anh, Ha Noi", "route": "Tuyến 3", "atm_id": 99098006}
{"lat": 21.046071, "lon": 105.9116194, "final_address": "Vinhomes Riverside, Hà Nội, Việt Nam", "display": "Vinhomes Riverside, Phường Phúc Lợi, Thành phố Hà Nội, Việt Nam", "raw_address": "Vinhomes Riverside, Hà Nội, Việt Nam", "route": "Tuyến 3", "atm_id": 99098024}
{"lat": 20.9913041, "lon": 105.9457424, "final_address": "ĐH VinUni, Xã Gia Lâm, Hà Nội, Việt Nam", "display": "Đại học VinUni, San Hô 17, Vinhomes Ocean Park, Xã Gia Lâm, Thành phố Hà Nội, Việt Nam", "raw_address": "ĐH VinUni, Xã Gia Lâm, HN", "route": "Tuyến 3", "atm_id": 99098027}
{"lat": 21.1632963, "lon": 105.8579055, "final_address": "BENH VIEN BAC THANG LONG, Hà Nội, Việt Nam", "display": "Bệnh viện Bắc Thăng Long, Đường Uy Nỗ, Đông Anh, Thành phố Hà Nội, Việt Nam", "raw_address": "BENH VIEN BAC THANG LONG", "route": "Tuyến 3", "atm_id": 99098034}
{"lat": 21.0327794, "lon": 105.8551338, "final_address": "So 20 Hang Tre, Hà Nội, Việt Nam", "display": "BIDV, Phố Hàng Tre, Khu phố cổ, Phường Hoàn Kiếm, Thành phố Hà Nội, 11011, Việt Nam", "raw_address": "So 20 Hang Tre", "route": "Tuyến 3", "atm_id": 99098043}
{"lat": 21.1623196, "lon": 105.8566841, "final_address": "BVDK DONG ANH, Hà Nội, Việt Nam", "display": "Đông Anh (BVĐK Bắc Thăng Long) - Tuyến 96, Đường Uy Nỗ, Xã Thư Lâm, Thành phố Hà Nội, Việt Nam", "raw_address": "BVDK DONG ANH, TT DONG ANH HA NOI", "route": "Tuyến 3", "atm_id": 99098045}
{"lat": 21.1352589, "lon": 105.8618583, "final_address": "thị trấn đông anh, hà nội, việt nam", "display": "Thị trấn Đông Anh, Đường Cổ Loa, Xã Đông Anh, Thành phố Hà Nội, 12323, Việt Nam", "raw_address": "thị trấn đông anh, hà nội, việt nam", "route": "Tuyến 3", "atm_id": 99098052}
{"lat": 21.0799208, "lon": 105.9807154, "final_address": "Khu công nghiệp VSIP Bắc Ninh, Xã Đại Đồng, Tỉnh Bắc Ninh, Việt Nam", "display": "Khu công nghiệp VSIP Bắc Ninh, Xã Đại Đồng, Tỉnh Bắc Ninh, Việt Nam", "raw_address": "Khu công nghiệp VSIP Bắc Ninh, Xã Đại Đồng, Tỉnh Bắc Ninh, Việt Nam", "route": "Tuyến 3", "atm_id": 99098056}
{"lat": 21.0920507, "lon": 105.9620622, "final_address": "KCN VSIP BAC NINH, Hà Nội, Việt Nam", "display": "KCN VSIP, Đường cao tốc Hà Nội - Bắc Giang, Ao Sen, Từ Sơn, Phường Từ Sơn, Tỉnh Bắc Ninh, 10165, Việt Nam", "raw_address": "KCN VSIP BAC NINH", "route": "Tuyến 3", "atm_id": 99098081}
{"lat": 21.0119209, "lon": 105.9510315, "final_address": "741 Nguyễn Đức Thuận, Xã Gia Lâm, Hà Nội, Việt Nam", "display": "Đường Nguyễn Đức Thuận, Kiên Thành, Xã Gia Lâm, Thành phố Hà Nội, Việt Nam", "raw_address": "741 Nguyễn Đức Thuận, Xã Gia Lâm, HN", "route": "Tuyến 3", "atm_id": 99098108}
{"lat": 21.0108138, "lon": 105.9350697, "final_address": "pho ngo xuan quang, ha noi, vietnam", "display": "Phố Ngô Xuân Quảng, Xã Gia Lâm, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "pho ngo xuan quang, ha noi, vietnam", "route": "Tuyến 3", "atm_id": 99098109}
{"lat": 21.0576756, "lon": 105.8906674, "final_address": "122 Ngô Gia Tự, P Long Biên, Hà Nội, Việt Nam", "display": "Agribank, Đường Ngô Gia Tự, Phường Việt Hưng, Thành phố Hà Nội, 11810, Việt Nam", "raw_address": "122 Ngô Gia Tự, P Long Biên, HN", "route": "Tuyến 3", "atm_id": 99098121}
{"lat": 21.046224, "lon": 105.8810422, "final_address": "37 NGUYEN SON, Hà Nội, Việt Nam", "display": "Ngõ 117 Phố Nguyễn Sơn, Phường Bồ Đề, Thành phố Hà Nội, 11810, Việt Nam", "raw_address": "37 NGUYEN SON - P.NGOC LAM - LONG BIEN - HA NOI", "route": "Tuyến 3", "atm_id": 99098123}
{"lat": 21.0567811, "lon": 105.8658509, "final_address": "270 NGOC THUY - P.NGOC THUY - LONG BIEN - HA NOI, Hà Nội, Việt Nam", "display": "270 Ngọc Thụy, Đường Ngọc Thụy, Phường Bồ Đề, Thành phố Hà Nội, 11810, Việt Nam", "raw_address": "270 NGOC THUY - P.NGOC THUY - LONG BIEN - HA NOI", "route": "Tuyến 3", "atm_id": 99098125}
{"lat": 21.028681, "lon": 105.918974, "final_address": "765 Nguyễn Văn Linh, Hà Nội, Việt Nam", "display": "BIDV, 765, Đường Nguyễn Văn Linh, Phường Phúc Lợi, Trâu Quỳ, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "TRONG SAN TCT CP MAY 10- 765 NGUYEN VAN LINH - LONG BIEN- HA NOI", "route": "Tuyến 3", "atm_id": 99098126}
{"lat": 21.0405721, "lon": 105.8769229, "final_address": "108 Hoàng Như Tiếp, Hà Nội, Việt Nam", "display": "Bệnh viện Đa khoa Tâm Anh, 108, Phố Hoàng Như Tiếp, Phường Bồ Đề, Thành phố Hà Nội, 11810, Việt Nam", "raw_address": "SO 108 HOANG NHU TIEP - PHUONG BO DE - QUAN LONG BIEN", "route": "Tuyến 3", "atm_id": 99098127}
{"lat": 21.0377483, "lon": 105.7868849, "final_address": "Mipec LB 2, Hà Nội, Việt Nam", "display": "Mipec Rubik 360, Phường Cầu Giấy, Thành phố Hà Nội, Việt Nam", "raw_address": "Mipec LB 2 Long Biên II, P Long Biên, HN", "route": "Tuyến 3", "atm_id": 99098128}
{"lat": 21.0102038, "lon": 105.939139, "final_address": "Khu Hành chính Gia Lâm, hà nội, việt nam", "display": "Khu Hành chính huyện Gia Lâm - Tòa nhà Handico5, Phố Thành Trung, Xã Gia Lâm, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "Khu Hành chính Gia Lâm, hà nội, việt nam", "route": "Tuyến 3", "atm_id": 99098160}
{"lat": 21.0426842, "lon": 105.870632, "final_address": "137A Nguyễn Văn Cừ, Hà Nội, Việt Nam", "display": "BIDV, 137A, Đường Nguyễn Văn Cừ, Phường Bồ Đề, Thành phố Hà Nội, 11008, Việt Nam", "raw_address": "TRU SO CHI NHANH - 137A NGUYEN VAN CU - LONG BIEN - HA NOI", "route": "Tuyến 3", "atm_id": 99098164}
{"lat": 21.033528, "lon": 105.906958, "final_address": "463 NGUYEN VAN LINH, Hà Nội, Việt Nam", "display": "BIDV, 463, Đường Nguyễn Văn Linh, Phường Phúc Lợi, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "463 NGUYEN VAN LINH", "route": "Tuyến 3", "atm_id": 99098200}
{"lat": 21.033528, "lon": 105.906958, "final_address": "463 nguyen van linh, hanoi", "display": "BIDV, 463, Đường Nguyễn Văn Linh, Phường Phúc Lợi, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "463 nguyen van linh, hanoi", "route": "Tuyến 3", "atm_id": 99098201}
{"lat": 21.0322474, "lon": 105.9190026, "final_address": "469 NGUYEN VAN LINH, Hà Nội, Việt Nam", "display": "Ngách 765/168 Đường Nguyễn Văn Linh, Phường Phúc Lợi, Trâu Quỳ, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "469 NGUYEN VAN LINH", "route": "Tuyến 3", "atm_id": 99098202}
{"lat": 21.033528, "lon": 105.906958, "final_address": "463 nguyen van linh, hanoi", "display": "BIDV, 463, Đường Nguyễn Văn Linh, Phường Phúc Lợi, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "463 nguyen van linh, hanoi", "route": "Tuyến 3", "atm_id": 99098204}
{"lat": 21.0567811, "lon": 105.8658509, "final_address": "270 Ngọc Thủy, Hà Nội, Việt Nam", "display": "270 Ngọc Thụy, Đường Ngọc Thụy, Phường Bồ Đề, Thành phố Hà Nội, 11810, Việt Nam", "raw_address": "UBND PHUONG NGOC THUY - 270 NGOC THUY - LONG BIEN", "route": "Tuyến 3", "atm_id": 99098220}
{"lat": 21.025521, "lon": 105.8595274, "final_address": "Trần Quang Khải, P Hoàn Kiếm, Hà Nội, Việt Nam", "display": "Đường Trần Quang Khải, Phường Hoàn Kiếm, Thành phố Hà Nội, 10301, Việt Nam", "raw_address": "CRM 194 Trần Quang Khải, P Hoàn Kiếm, HN", "route": "Tuyến 3", "atm_id": 99099602}
{"lat": 21.2647496, "lon": 105.8980563, "final_address": "42 CAO LO, Hà Nội, Việt Nam", "display": "Đường cao tốc Hà Nội - Thái Nguyên, Xã Đa Phúc, Thành phố Hà Nội, 26920, Việt Nam", "raw_address": "42 CAO LO", "route": "Tuyến 3", "atm_id": 99099610}
{"lat": 21.0322474, "lon": 105.9190026, "final_address": "NGUYEN VAN LINH, Hà Nội, Việt Nam", "display": "Ngách 765/168 Đường Nguyễn Văn Linh, Phường Phúc Lợi, Trâu Quỳ, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "CRM - 469 NGUYEN VAN LINH", "route": "Tuyến 3", "atm_id": 99099622}
{"lat": 21.0426842, "lon": 105.870632, "final_address": "137A Nguyễn Văn Cừ, Hà Nội, Việt Nam", "display": "BIDV, 137A, Đường Nguyễn Văn Cừ, Phường Bồ Đề, Thành phố Hà Nội, 11008, Việt Nam", "raw_address": "CRM - 137A NGUYEN VAN CU", "route": "Tuyến 3", "atm_id": 99099624}
{"lat": 21.0119209, "lon": 105.9510315, "final_address": "741 NGUYÊN ĐỨC THUẬN, Hà Nội, Việt Nam", "display": "Đường Nguyễn Đức Thuận, Kiên Thành, Xã Gia Lâm, Thành phố Hà Nội, Việt Nam", "raw_address": "741 NGUYÊN ĐỨC THUẬN. ĐẶNG XÁ , GIA LÂM", "route": "Tuyến 3", "atm_id": 99099626}
{"lat": 20.9942646, "lon": 105.948475, "final_address": "VINHOMES OCEAN PARK, Hà Nội, Việt Nam", "display": "Vinhomes Ocean Park, Xã Gia Lâm, Thành phố Hà Nội, Việt Nam", "raw_address": "VINHOMES OCEAN PARK, Hà Nội, Việt Nam", "route": "Tuyến 3", "atm_id": 99099627}
{"lat": 21.0599869, "lon": 105.9114146, "final_address": "KDT VIET HUNG, Hà Nội, Việt Nam", "display": "Khu BT6 - KĐT Việt Hưng - Lưu Khánh Đàm, Phố Lưu Khánh Đàm, Khu đô thị Việt Hưng, Phường Việt Hưng, Thành phố Hà Nội, 08443, Việt Nam", "raw_address": "BT7-A49 NGUYEN CAO LUYEN, KDT VIET HUNG, LONG BIEN, HA NOI", "route": "Tuyến 3", "atm_id": 99099639}
{"lat": 21.0540148, "lon": 105.8926821, "final_address": "6 VU DUC THAN, VIET HUNG, HA NOI", "display": "Phố Vũ Đức Thận, Phường Việt Hưng, Thành phố Hà Nội, 11810, Việt Nam", "raw_address": "6 VU DUC THAN, VIET HUNG, HA NOI", "route": "Tuyến 3", "atm_id": 99099645}
{"lat": 21.0294534, "lon": 105.857076, "final_address": "bidv tower, 194 tran quang khai, ha noi", "display": "BIDV Tower, 194, Đường Trần Quang Khải, Phường Hoàn Kiếm, Thành phố Hà Nội, 10262, Việt Nam", "raw_address": "bidv tower, 194 tran quang khai, ha noi", "route": "Tuyến 1", "atm_id": 1}
{"lat": 21.0294534, "lon": 105.857076, "final_address": "bidv tower, 194 tran quang khai, ha noi", "display": "BIDV Tower, 194, Đường Trần Quang Khải, Phường Hoàn Kiếm, Thành phố Hà Nội, 10262, Việt Nam", "raw_address": "bidv tower, 194 tran quang khai, ha noi", "route": "Tuyến 2", "atm_id": 2}
{"lat": 21.0294534, "lon": 105.857076, "final_address": "bidv tower, 194 tran quang khai, ha noi", "display": "BIDV Tower, 194, Đường Trần Quang Khải, Phường Hoàn Kiếm, Thành phố Hà Nội, 10262, Việt Nam", "raw_address": "bidv tower, 194 tran quang khai, ha noi", "route": "Tuyến 3", "atm_id": 3}
`;

export default function App() {
  const [jsonl, setJsonl] = useState(demoJSONL);
  const [items, setItems] = useState(() => parseJSONL(demoJSONL));
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]); // chỉ chứa ATM cần đi trong ngày (KHÔNG tính depot)
  const [routeIds, setRouteIds] = useState([]); // kết quả từ API: list atm_id theo thứ tự (có depot ở đầu & cuối)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Map by id để tra cứu nhanh
  const byId = useMemo(() => new Map(items.map((x) => [x.atm_id, x])), [items]);

  // Đảm bảo có depot trong dữ liệu
  const depot = byId.get(DEPOT_ID);

  useEffect(() => {
    setItems(parseJSONL(jsonl));
  }, [jsonl]);

  useEffect(() => {
    setRouteIds([]);
    setError("");
  }, [selectedIds.join(","), items.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = items.filter(x => x.atm_id !== DEPOT_ID); // ẩn depot khỏi danh sách chọn
    if (!q) return arr;
    return arr.filter(x =>
      String(x.atm_id).includes(q) ||
      (x.raw_address?.toLowerCase().includes(q)) ||
      (x.final_address?.toLowerCase().includes(q)) ||
      (x.route?.toLowerCase().includes(q))
    );
  }, [items, query]);

  const selectedPoints = selectedIds.map(id => byId.get(id)).filter(Boolean);

  const center = useMemo(() => {
    const all = [depot, ...selectedPoints].filter(Boolean);
    if (!all.length) return [21.0278, 105.8342];
    const lat = all.reduce((s, p) => s + p.lat, 0) / all.length;
    const lon = all.reduce((s, p) => s + p.lon, 0) / all.length;
    return [lat, lon];
  }, [depot, selectedPoints]);

  function addId(id) {
    if (selectedIds.includes(id)) return;
    if (selectedIds.length >= DAILY_LIMIT) {
      setError(`Đã đủ ${DAILY_LIMIT} ATM cho hôm nay (không tính trụ sở).`);
      return;
    }
    setSelectedIds(prev => [...prev, id]);
  }

  function removeId(id) {
    setSelectedIds(prev => prev.filter(x => x !== id));
  }

  async function solveWithOrtools() {
    setError("");
    if (!depot) { setError(`Không tìm thấy depot (atm_id=${DEPOT_ID}) trong dữ liệu.`); return; }
    if (selectedIds.length === 0) { setError("Chưa chọn ATM nào."); return; }

    const payload = {
      depot_id: DEPOT_ID,
      atms: [depot, ...selectedPoints] // server sẽ đảm bảo start/end ở depot
        .map(x => ({ atm_id: x.atm_id, lat: x.lat, lon: x.lon, final_address: x.final_address, raw_address: x.raw_address }))
    };

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRouteIds(data.order_ids); // [depot, ..., depot]
    } catch (e) {
      setError(`Lỗi gọi OR-Tools API: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    if (!routeIds.length) return;
    const blob = toCSV(items, routeIds, byId);
    saveAs(blob, "route_ortools.csv");
  }

  const routeCoords = useMemo(() => {
    return routeIds.map(id => byId.get(id)).filter(Boolean).map(p => [p.lat, p.lon]);
  }, [routeIds, byId]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <MapPinned className="w-6 h-6" />
          <h1 className="text-xl font-semibold">ATM Route Planner</h1>
          <span className="ml-auto text-sm text-gray-500">Chọn tối đa {DAILY_LIMIT} ATM (không tính depot #{DEPOT_ID})</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid md:grid-cols-5 gap-4 p-4">
        {/* Left panel */}
        <section className="md:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              <h2 className="font-medium">Nguồn dữ liệu ATM</h2>
            </div>
            <input type="file" accept=".json,.jsonl,.txt" onChange={(e)=>{ const f=e.target.files?.[0]; if(!f)return; const r=new FileReader(); r.onload=()=>setJsonl(String(r.result||"")); r.readAsText(f); }} className="block w-full text-sm" />
            <textarea className="w-full h-40 p-3 border rounded-xl focus:outline-none focus:ring" value={jsonl} onChange={(e)=>setJsonl(e.target.value)} />
            <p className="text-xs text-gray-500">Mỗi dòng là một JSON: {`{ lat, lon, atm_id, raw_address, final_address, route }`}. Nhớ có bản ghi depot với <b>atm_id = {DEPOT_ID}</b>.</p>
          </div>

          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Route className="w-4 h-4" />
              <h2 className="font-medium">Chọn ATM trong ngày (tối đa {DAILY_LIMIT})</h2>
            </div>
            <input className="w-full p-2 border rounded-xl" placeholder="Tìm theo ID / địa chỉ / tuyến..." value={query} onChange={(e)=>setQuery(e.target.value)} />
            <div className="max-h-56 overflow-auto border rounded-xl divide-y">
              {filtered.map((it) => (
                <div key={it.atm_id} className="flex items-center justify-between p-2 gap-3">
                  <div className="text-sm leading-tight">
                    <div className="font-medium">#{it.atm_id} — {it.raw_address || it.final_address}</div>
                    <div className="text-gray-500">{it.final_address}</div>
                  </div>
                  <button disabled={selectedIds.includes(it.atm_id) || selectedIds.length>=DAILY_LIMIT} className="px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50" onClick={()=>addId(it.atm_id)}>Thêm</button>
                </div>
              ))}
            </div>

            <div className="text-sm text-gray-700">Đã chọn: {selectedIds.length}/{DAILY_LIMIT}</div>
            <div className="max-h-40 overflow-auto border rounded-xl divide-y">
              {selectedPoints.map((it)=> (
                <div key={it.atm_id} className="flex items-center justify-between p-2">
                  <div>#{it.atm_id} — {it.raw_address || it.final_address}</div>
                  <button className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={()=>removeId(it.atm_id)}>Gỡ</button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button className="px-4 py-2 rounded-xl bg-black text-white flex items-center gap-2 hover:opacity-90" onClick={solveWithOrtools} disabled={loading}>
                <Network className="w-4 h-4"/> {loading?"Đang tính...":"Tính bằng OR-Tools (API)"}
              </button>
              <button className="px-4 py-2 rounded-xl bg-gray-100 flex items-center gap-2 hover:bg-gray-200" onClick={()=>{setSelectedIds([]); setRouteIds([]);}}> <Trash2 className="w-4 h-4"/> Xoá chọn </button>
              <button className="px-4 py-2 rounded-xl bg-gray-100 flex items-center gap-2 hover:bg-gray-200" onClick={exportCSV} disabled={!routeIds.length}> <Download className="w-4 h-4"/> CSV </button>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
          </div>
        </section>

        {/* Map + results */}
        <section className="md:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <MapContainer center={center} zoom={12} style={{ height: 480 }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
              {depot && (
                <Marker position={[depot.lat, depot.lon]}>
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold">Depot #{DEPOT_ID}</div>
                      <div>{depot.final_address || depot.raw_address}</div>
                    </div>
                  </Popup>
                </Marker>
              )}
              {selectedPoints.map((p) => (
                <Marker key={p.atm_id} position={[p.lat, p.lon]}>
                  <Popup>
                    <div className="text-sm">
                      <div className="font-medium">#{p.atm_id} — {p.raw_address || p.final_address}</div>
                      <div className="text-gray-600">{p.final_address}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
              {routeCoords.length > 1 && (
                <Polyline positions={routeCoords} />
              )}
            </MapContainer>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-medium mb-3">Kết quả (OR-Tools)</h2>
            {!routeIds.length ? (
              <p className="text-sm text-gray-500">Chưa có lộ trình — bấm "Tính bằng OR-Tools (API)".</p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="px-2 py-1">#</th>
                      <th className="px-2 py-1">ATM</th>
                      <th className="px-2 py-1">Địa chỉ</th>
                      <th className="px-2 py-1">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeIds.map((id, idx) => {
                      const it = byId.get(id);
                      return (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-1 font-medium">{idx + 1}</td>
                          <td className="px-2 py-1">#{id}</td>
                          <td className="px-2 py-1">{it?.final_address || it?.raw_address}</td>
                          <td className="px-2 py-1">{id===DEPOT_ID? (idx===0?"Start (Depot)":"End (Depot)") : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-4 text-sm text-gray-600">
            <h3 className="font-medium mb-2">Ghi chú</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Danh sách chọn trong ngày <b>không tính depot</b>. Hệ thống tự động thêm depot #{DEPOT_ID} ở đầu và cuối route.</li>
              <li>Backend FastAPI dùng OR-Tools để tối ưu chính xác; Frontend gọi <code>/solve</code> với các ATM bạn chọn.</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="py-6 text-center text-xs text-gray-500">© {new Date().getFullYear()} ATM Route Planner</footer>
    </div>
  );
}
