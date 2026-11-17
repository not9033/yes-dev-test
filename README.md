
ระบบจัดการสินค้า นำเข้า Excel แสดงข้อมูลผ่าน QR และสรุปยอดเปิดหน้าสินค้า สร้างด้วย React + Vite + TypeScript, Firebase Authentication, Firestore, Storage และ Cloud Functions

## เตรียม Firebase project สำหรับพัฒนา

1. ใช้ Firebase project แยกสำหรับการพัฒนา เปิด **Authentication > Email/Password**, Firestore และ Storage; Storage ต้องใช้แผน Blaze
2. ลงทะเบียน Web app แล้วคัดลอก `.env.example` เป็น `.env.local` ในโฟลเดอร์นี้ ใส่ค่า Web config และ `VITE_FIREBASE_PROJECT_ID` ให้ตรงกับ project ที่ใช้
3. คัดลอก `functions/.env.example` เป็น `functions/.env` ตั้ง `SCAN_RATE_SALT` และ `BOOTSTRAP_SECRET` เป็นค่าสุ่มคนละค่า และตั้ง `PUBLIC_BASE_URL` ให้ตรงกับ URL หน้าเว็บสำหรับลิงก์คำเชิญ หากใช้ service account ให้ตั้ง `GOOGLE_APPLICATION_CREDENTIALS` เป็น path ของไฟล์ที่เก็บไว้นอก repository
4. `firebase login` แล้วทดสอบ Firestore/Storage Rules กับ Emulator ก่อนเผยแพร่ Rules ด้วย `firebase deploy --only firestore:rules,storage --project <PROJECT_ID>` คำสั่งนี้ไม่ deploy เว็บไซต์หรือ Functions กฎ Storage อ่านสถานะผู้ดูแลจาก Firestore จึงต้องให้ IAM role `roles/firebaserules.firestoreServiceAgent` กับ service agent `service-<PROJECT_NUMBER>@gcp-sa-firebasestorage.iam.gserviceaccount.com` ด้วย (Firebase CLI แบบ interactive อาจเสนอให้เพิ่มสิทธิ์นี้ระหว่าง deploy)
5. สร้างผู้ใช้ Super Admin คนแรกใน Firebase Authentication Console ด้วยอีเมลและรหัสผ่านที่ผู้ดูแลกำหนด หลังเริ่ม Functions Emulator ให้รัน `npm --prefix functions run bootstrap:local -- admin@example.com` ในอีก terminal คำสั่งนี้ส่ง secret ไปยัง endpoint ที่เปิดเฉพาะ Emulator เพื่อกำหนด Custom Claim, สถานะบัญชี และหมวดหมู่เริ่มต้น

อย่า commit `.env.local`, `functions/.env` หรือ service account key ลง Git หากเลือกใช้สคริปต์ `npm --prefix functions run bootstrap -- admin@example.com` แทนวิธีข้างต้น ต้องตั้ง Application Default Credentials ใน shell ที่รันสคริปต์

## รันในเครื่อง

```powershell
npm install
npm --prefix functions install
npm --prefix functions run build
firebase emulators:start --only functions --project <PROJECT_ID>
```

เปิดอีก terminal แล้วรัน `npm run dev` จากโฟลเดอร์นี้ เว็บจะอยู่ที่ `http://localhost:5173` การตั้งค่านี้เปิด **เฉพาะ Functions Emulator** ดังนั้น Auth, Firestore และ Storage ที่ไม่ได้เปิด Emulator จะเชื่อมกับ Firebase project จริง ตรวจ project ID และ credentials ทุกครั้งก่อนรัน

สำหรับสแกน QR จากโทรศัพท์ใน Wi-Fi เดียวกัน ให้ตั้ง `VITE_PUBLIC_BASE_URL=http://<LAN_IP>:5173` และ `PUBLIC_BASE_URL=http://<LAN_IP>:5173` แล้วรัน `npm run dev:lan` และ Functions Emulator เว็บส่งคำขอ `/api` ผ่าน Vite ไปยัง Functions ในเครื่อง โทรศัพท์จึงต้องเข้าถึงเพียงพอร์ต 5173 และ firewall ต้องอนุญาตพอร์ตนี้ URL บน LAN มีไว้ทดสอบ เมื่อได้โดเมนจริงต้องสร้าง QR ใหม่ก่อนพิมพ์ใช้งาน

## รูปแบบ Excel

รองรับ `.xlsx` แผ่นงานแรก ขนาดไม่เกิน 5 MB และไม่เกิน 1,000 แถวข้อมูล หัวตารางใช้ชื่อคอลัมน์ด้านล่าง (ตัวพิมพ์ใหญ่เล็กไม่สำคัญ):

| คอลัมน์ | กติกา |
| --- | --- |
| `sku` | บังคับ เป็นข้อความรูปแบบ `LS-0000` และไม่ซ้ำ |
| `name` | บังคับ เป็นข้อความ |
| `price` | บังคับ เป็นตัวเลขเงินบาทมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง |
| `category` | ไม่บังคับ ต้องเป็นหมวดหมู่ที่มีในระบบ |
| `size` | ไม่บังคับ เป็นข้อความ เช่น `30 ml` หรือ `50 g` |
| `description` | ไม่บังคับ เป็นข้อความ |
| `how_to_use` | ไม่บังคับ เป็นข้อความ |
| `status` | ไม่บังคับ `active` หรือ `inactive`; ว่างเป็น `active` |

SKU ที่ Excel เก็บเป็นตัวเลขโดยไม่มีรูปแบบเลขศูนย์นำหน้าไม่สามารถกู้เลขศูนย์ที่หายไปได้ ให้เก็บคอลัมน์ SKU เป็นข้อความ หาก SKU มีอยู่แล้ว ระบบอัปเดตสินค้าเดิมโดยคง ID, URL, QR และรูปไว้ เซลล์ที่ว่างใช้ค่าเดิม รวมถึงสถานะ หาก SKU ซ้ำกันในไฟล์ แถวหลังอัปเดตทับแถวก่อนตามลำดับแถว Import ที่ถูกขัดจังหวะเปิดจากหน้า **ประวัตินำเข้า** แล้วกดดำเนินการต่อได้

หลังตรวจไฟล์ สามารถยืนยันนำเข้าทั้งแถวปกติและแถวที่มีข้อผิดพลาดได้ แถวที่ขาด SKU/ชื่อ/ราคาหรือมีค่าไม่ถูกกติกาจะถูกเก็บเป็นร่าง `inactive` พร้อมค่าเดิมจาก Excel และสาเหตุในหน้าจัดการสินค้า ต้องแก้ข้อมูลบังคับให้ถูกต้องก่อนเปิดเป็น `active` แถวที่ไม่มี SKU จะสร้างเป็นร่างใหม่ เพราะไม่สามารถจับคู่สินค้าเดิมได้

## รูปภาพและการเปิดหน้า

รูปหลักได้ 1 รูป รับ JPEG, PNG หรือ WebP ไม่เกิน 2 MB แนะนำสี่เหลี่ยมจัตุรัสอย่างน้อย 800 × 800 พิกเซล หากยังไม่มีรูป หน้าเว็บใช้ placeholder สินค้า `inactive` ไม่แสดงรายละเอียดแม้เปิด URL โดยตรง

ยอด “เปิดหน้าสินค้าผ่านลิงก์ QR” นับเฉพาะหน้า `active` ที่มี `source=qr` และป้องกันเหตุการณ์ซ้ำด้วยรหัสเหตุการณ์ รีเฟรชถือเป็นการเปิดใหม่ Dashboard แสดงยอดตามวันที่ในเขตเวลาไทย

คำเชิญ Admin มีอายุ 24 ชั่วโมงและใช้ครั้งเดียว หากตั้งค่า Mailtrap SMTP ใน `functions/.env` ระบบจะส่งอีเมลไป Mailtrap; หากไม่ได้ตั้งค่า Functions Emulator จะพิมพ์ลิงก์คำเชิญใน log เฉพาะการพัฒนา

## ตรวจสอบ

```powershell
npm run build
npm run lint
npm --prefix functions test
npm run test:rules
npm run test:integration
```

`test:rules` และ `test:integration` ใช้ Firebase Emulators กับ project จำลอง ไม่แตะ Firebase จริง ก่อนใช้งานจริงให้ทดสอบเส้นทางตั้งแต่เชิญ Admin → นำเข้า Excel → เพิ่มรูป → สร้าง QR → เปิดจากโทรศัพท์ด้วย project สำหรับพัฒนา

ไฟล์ตัวอย่างใน workspace คือ `luma_products.xlsx` และ `luma_products_update.xlsx` ไฟล์หลังใช้ทดสอบการอัปเดตสินค้าด้วย SKU เดิมและการคงค่าในเซลล์ว่าง
